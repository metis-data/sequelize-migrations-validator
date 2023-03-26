const execSync = require('child_process').execSync;
execSync('npm install -g pgsql-parser');
const globalPath = execSync('npm root -g');
const parserPath = `${globalPath}`.replace('\n', '') + '/pgsql-parser/main';
const core = require('@actions/core');
const ts = require('typescript');
const requireFromString = require('require-from-string');
const axios = require('axios');
const path = require('path');
const { parse } = require(parserPath);
const { context, getOctokit } = require('@actions/github');
const { DataTypes, Sequelize } = require('sequelize');

const SEQUELIZE_EXECUTION_LOG_PREFIX = 'Executing (default): ';

function compileTypescript(path) {
  const compilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.CommonJS,
  };

  const program = ts.createProgram([path], compilerOptions);
  const emitResult = program.emit();
  const allDiagnostics = ts
    .getPreEmitDiagnostics(program)
    .concat(emitResult.diagnostics);

  if (allDiagnostics.length) {
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(allDiagnostics, {
        getCurrentDirectory: ts.sys.getCurrentDirectory,
        getNewLine: () => ts.sys.newLine,
        getCanonicalFileName: (fileName) => fileName,
      }),
    );
  }
  return ts.sys.readFile(`${path.replace('.ts', '.js')}`);
}

async function main() {
  try {
    const shaFrom = core.getInput('from');
    const shaTo = core.getInput('to');
    const apiKey = core.getInput('metis_api_key');
    const githubToken = core.getInput('github_token');
    const url = core.getInput('target_url');
    const migrationsDir = core.getInput('migrations_dir');
    const pull_request = context.payload?.pull_request;
    const octokit = getOctokit(githubToken);

    console.log(`Sha from ${shaFrom}`);
    console.log(`Sha to ${shaTo}`);
    console.log(`Api key ${apiKey}`);
    console.log(`Migrations dir ${migrationsDir}`);

    const output = execSync(
      `git diff --diff-filter=ACM ${shaFrom} ${shaTo} --name-only ${migrationsDir} | egrep -h '.js|.ts' | jq -Rsc '. / "\n" - [""]'`,
    );
    const newMigrationsFiles = JSON.parse(output);
    console.log(`New files paths: ${newMigrationsFiles}`);
    if (newMigrationsFiles.length) {
      const queries = [];
      const sequelize = new Sequelize({
        host: 'localhost',
        port: 5432,
        username: 'postgres',
        password: 'postgres',
        database: 'postgres',
        dialect: 'postgres',
        logging: (sql) => queries.push(sql),
      });
      const queryInterface = sequelize.getQueryInterface();

      const migrationsData = [];
      const insights = {};
      await Promise.all(
        newMigrationsFiles.map(async (migration, index) => {
          const requirePath = path.join(process.cwd(), migration);
          console.log(`Path: ${requirePath}`);
          let tsOutput, up, down;
          if (migration.endsWith('.ts')) {
            tsOutput = compileTypescript(requirePath);
            ({ up, down } = requireFromString(tsOutput));
          } else {
            ({ up, down } = require(requirePath));
          }
          if (typeof up !== 'function' || typeof down !== 'function') {
            core.info(
              `Migration file ${migration} is missing up/down definitions`,
            );
            return;
          }
          await up(queryInterface, DataTypes);
          await down(queryInterface, DataTypes);

          const innerInsights = [];
          queries.map((query) => {
            const cleanQuery = query.split(SEQUELIZE_EXECUTION_LOG_PREFIX)?.[1];
            migrationsData.push(cleanQuery);
            const insight = parse(cleanQuery);
            innerInsights.push(...insight);
          });

          queries.length = 0;
          Object.assign(insights, { [index]: innerInsights });
        }),
      );

      console.log('Trying to send insights');
      const res = await axios.post(
        `${url}/api/migrations/create`,
        {
          migrationsData,
          prId: `${pull_request.number}`,
          prName: pull_request.title || context.sha,
          prUrl: pull_request.html_url,
          insights,
        },
        { headers: { 'x-api-key': apiKey } },
      );
      console.log(
        `Got response status: ${res.status} with text: ${res.statusText}`,
      );

      await octokit.rest.issues.createComment({
        ...context.repo,
        issue_number: pull_request.number,
        body: `Metis analyzed your new migrations files. View the results under Pull Requests in the link: 
          ${encodeURI(`${url}/projects/${apiKey}`)}`,
      });
    }
  } catch (e) {
    core.error(e);
    core.setFailed(e);
  }
}

main();
