const core = require("@actions/core");
const execSync = require("child_process").execSync;
const fs = require("fs");
const axios = require("axios");
const path = require("path");
const { context, getOctokit } = require('@actions/github');
const { DataTypes, Sequelize } = require('sequelize');

const SEQUELIZE_EXECUTION_LOG_PREFIX = 'Executing (default): ';

async function main() {
  try {
    const shaFrom = core.getInput("from");
    const shaTo = core.getInput("to");
    const apiKey = core.getInput("metis_api_key");
    const githubToken = core.getInput("github_token");
    const url = core.getInput("target_url");
    const migrationsDir = core.getInput("migrations_dir");
    const pull_request = context.payload?.pull_request;
    const octokit = getOctokit(githubToken);

    console.log(`Sha from ${shaFrom}`);
    console.log(`Sha to ${shaTo}`);
    console.log(`Api key ${apiKey}`);
    console.log(`Migrations dir ${migrationsDir}`);

    const output = execSync(`git diff --diff-filter=ACM ${shaFrom} ${shaTo} --name-only ${migrationsDir} | jq -Rsc '. / "\n" - [""]'`);
    const newMigrationsFiles = JSON.parse(output);
    console.log(`New files paths: ${newMigrationsFiles}`);
    if (newMigrationsFiles.length) {
      const queries = [];
      execSync('npm install -g pgsql-parser');
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
      const tempMigrations = [];
      await Promise.all(
        newMigrationsFiles.map(async (migration, index) => {
          if (migration.endsWith('.js') || migration.endsWith('.ts')) {
            const requirePath = path.join(process.cwd(), migration);
            console.log(`Path: ${requirePath}`);
            const { up, down } = require(`${requirePath}`);
            if (typeof up !== 'function' || typeof down !== 'function') {
              core.info(`Migration file ${migration} is missing up/down definitions`);
              return;
            }
            const tempMigration = `temp_${index}.sql`;
            tempMigrations.push(tempMigration);
            await up(queryInterface, DataTypes);
            const rawUpSql = queries.pop()?.split(SEQUELIZE_EXECUTION_LOG_PREFIX)?.[1];
            console.log(`Got up sql ${rawUpSql}`);
            fs.writeFileSync(tempMigration, rawUpSql, { encoding: 'utf-8', flag: 'wx' } );

            await down(queryInterface, DataTypes);
            const rawDownSql = queries.pop()?.split(SEQUELIZE_EXECUTION_LOG_PREFIX)?.[1];
            console.log(`Got down sql ${rawDownSql}`);
            fs.appendFileSync(tempMigration, rawDownSql, { encoding: 'utf-8' });
          }
        }),
      );
      console.log(`Applied migrations ${tempMigrations}`);

      tempMigrations.map((migration, index) => {
        migrationsData.push(fs.readFileSync(migration, { encoding: 'utf-8' }));
        console.log(`Running the parser on migration ${migration}`);
        const rawInsight = execSync(`pgsql-parser ${migration}`);
        const insight = JSON.parse(rawInsight);
        console.log(`Got insights ${insight}`);
        Object.assign(insights, {[index]: insight});
      });

      console.log('Trying to send insights');
      const res = await axios.post(`${url}/api/migrations/create`, {
        migrationsData,
        prId: `${pull_request.number}`,
        apiKey,
        insights
      });
      console.log(res);

      await octokit.rest.issues.createComment({
        ...context.repo,
        issue_number: pull_request.number,
        body: `Metis analyzed your new migrations files. View the results in the link: ${encodeURI(
          `${url}/migrations/${apiKey}/${pull_request.number}`
        )}`,
      });
    }
  } catch (e) {
    core.error(e);
    core.setFailed(e);
  }
}

main();