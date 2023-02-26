# sequelize-migrations-validator
Github action for auto analyze sequelize migrations files in PRs

## Sequelize Migrations Validator Action For GitHub Actions

An action for auto recognize new sequelize migrations files submitted in a pull request. Those files will be sent to be analyzed 
and derive insights on Metis-data platform.

## Usage

Add the following step to your workflow:
```
  - name: Analyze migrations
    uses: metis-data/sequelize-migrations-validator@v1
    with:
      from: ${{ github.event.pull_request.base.sha }}
      to: ${{ github.event.pull_request.head.sha }}
      github_token: ${{ github.token }}
      metis_api_key: <Your Api Key>
      migrations_dir: <path/to/migrations/directory>
```
For example, you can run it in a GitHub Actions workflow job.
```
    on:
      pull_request:
        types: [opened, reopened, edited, synchronize, ready_for_review]
    
    jobs:
      migrations:
        name: Analyze new migrations
        runs-on: ubuntu-latest
        services:
          postgres:
            image: postgres
            env:
              POSTGRES_USER: postgres
              POSTGRES_PASSWORD: postgres
              POSTGRES_DB: postgres
            ports:
              - 5432:5432
            options: >-
              --health-cmd pg_isready
              --health-interval 10s
              --health-timeout 5s
              --health-retries 5
        steps:
          - name: Checkout
            uses: actions/checkout@v3
            with:
              fetch-depth: 0
          - name: Compare migrations
            uses: metis-data/sql-migrations-validator@v1
            with:
              from: ${{ github.event.pull_request.base.sha }}
              to: ${{ github.event.pull_request.head.sha }}
              github_token: ${{ github.token }}
              metis_api_key: <Your Api Key>
              migrations_dir: migrations
```
> :warning: **Note:** This workflow need to set up postgres container for Sequelize connection that can take a moment. 
> The check for actual changes is after the container setup so if you wish to avoid unnecessary runs it is recommended
> to disable the workflow when no new migrations are present.

### Parameters
- `from`: Base sha to be compared
- `to`: Branch sha to be compared with
- `github_token`: Auto generated workflow GitHub token
- `metis_api_key`: Metis Api Key generated at [Metis](https://app.metisdata.io/)
- `migrations_dir`: Path in your project to Sequelize migrations directory

## License Summary
This code is made available under the MIT license.

## Issues
If you would like to report a potential issue please use [Issues](https://github.com/metis-data/sequelize-migrations-validator/issues)