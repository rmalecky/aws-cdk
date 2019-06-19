import fs = require('fs');
import util = require('util');
import yargs = require('yargs');
import { shell } from '../lib/os';
import { cdkBuildOptions, configFilePath, currentPackageJson, hasIntegTests, hasOnlyAutogeneratedTests, unitTestFiles } from '../lib/package-info';
import { Timers } from '../lib/timer';

async function main() {
  const args = yargs
    .env('CDK_TEST')
    .usage('Usage: cdk-test')
    .option('jsii-diff', {
      type: 'string',
      desc: 'Specify a different jsii-diff executable',
      default: require.resolve('jsii-diff/bin/jsii-diff'),
      defaultDescription: 'jsii-diff provided by node dependencies'
    })
    .option('jest', {
      type: 'string',
      desc: 'Specify a different jest executable',
      default: require.resolve('jest/bin/jest'),
      defaultDescription: 'jest provided by node dependencies'
    })
    .option('nyc', {
      type: 'string',
      desc: 'Specify a different nyc executable',
      default: require.resolve('nyc/bin/nyc'),
      defaultDescription: 'nyc provided by node dependencies'
    })
    .option('nodeunit', {
      type: 'string',
      desc: 'Specify a different nodeunit executable',
      default: require.resolve('nodeunit/bin/nodeunit'),
      defaultDescription: 'nodeunit provided by node dependencies'
    })
    .argv;

  const options = cdkBuildOptions();

  if (options.test) {
    await shell(options.test, { timers });
  }

  const testFiles = await unitTestFiles();
  const useJest = 'jest' in currentPackageJson();

  if (useJest) {
    if (testFiles.length > 0) {
      throw new Error(`Jest is enabled, but ${testFiles.length} nodeunit tests were found!`);
    }
    await shell([args.jest, '--testEnvironment=node', '--coverage', '--coverageReporters', 'html', 'lcov', 'text-summary'], { timers });
  } else if (testFiles.length > 0) {
    const testCommand: string[] = [];

    // We always run the tests, but include an 'nyc' run (for coverage)
    // if and only if the package is not completely autogenerated.
    //
    // We cannot pass the .nycrc config file using '--nycrc-path', because
    // that can only be a filename relative to '--cwd', but if we set '--cwd'
    // nyc doesn't find the source files anymore.
    //
    // We end up symlinking .nycrc into the package.
    if (!await hasOnlyAutogeneratedTests()) {
      try {
        await util.promisify(fs.symlink)(configFilePath('nycrc'), '.nycrc');
      } catch (e) {
        // It's okay if the symlink already exists
        if (e.code !== 'EEXIST') { throw e; }
      }
      testCommand.push(...[args.nyc, '--clean']);
    }
    testCommand.push(args.nodeunit);
    testCommand.push(...testFiles.map(f => f.path));

    await shell(testCommand, { timers });
  }

  // Run integration test if the package has integ test files
  if (await hasIntegTests()) {
    await shell(['cdk-integ-assert'], { timers });
  }
}

const timers = new Timers();
const buildTimer = timers.start('Total time');

main().then(() => {
  buildTimer.end();
  process.stdout.write(`Tests successful. ${timers.display()}\n`);
}).catch(e => {
  buildTimer.end();
  process.stderr.write(`${e.toString()}\n`);
  process.stderr.write(`Tests failed. ${timers.display()}\n`);
  process.stderr.write(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n`);
  process.exit(1);
});
