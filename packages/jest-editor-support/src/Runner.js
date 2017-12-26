/**
 * Copyright (c) 2014-present, Facebook, Inc. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Options} from './types';

import {ChildProcess, spawn} from 'child_process';
import {readFile} from 'fs';
import {tmpdir} from 'os';
import EventEmitter from 'events';
import ProjectWorkspace from './project_workspace';
import {createProcess} from './Process';

// This class represents the running process, and
// passes out events when it understands what data is being
// pass sent out of the process
export default class Runner extends EventEmitter {
  debugprocess: ChildProcess;
  outputPath: string;
  workspace: ProjectWorkspace;
  _createProcess: (
    workspace: ProjectWorkspace,
    args: Array<string>,
  ) => ChildProcess;
  watchMode: boolean;
  options: Options;

  constructor(workspace: ProjectWorkspace, options?: Options) {
    super();
    this._createProcess = (options && options.createProcess) || createProcess;
    this.options = options || {};
    this.workspace = workspace;
    this.outputPath = tmpdir() + '/jest_runner.json';
  }

  start(watchMode: boolean = true) {
    if (this.debugprocess) {
      return;
    }

    this.watchMode = watchMode;

    // Handle the arg change on v18
    const belowEighteen = this.workspace.localJestMajorVersion < 18;
    const outputArg = belowEighteen ? '--jsonOutputFile' : '--outputFile';

    const args = ['--json', '--useStderr', outputArg, this.outputPath];
    if (this.watchMode) args.push('--watch');
    if (this.options.testNamePattern) {
      args.push('--testNamePattern', this.options.testNamePattern);
    }
    if (this.options.testFileNamePattern) {
      args.push(this.options.testFileNamePattern);
    }

    this.debugprocess = this._createProcess(this.workspace, args);
    this.debugprocess.stdout.on('data', (data: Buffer) => {
      // Make jest save to a file, otherwise we get chunked data
      // and it can be hard to put it back together.
      const stringValue = data
        .toString()
        .replace(/\n$/, '')
        .trim();
      if (stringValue.startsWith('Test results written to')) {
        readFile(this.outputPath, 'utf8', (err, data) => {
          if (err) {
            const message = `JSON report not found at ${this.outputPath}`;
            this.emit('terminalError', message);
          } else {
            this.emit('executableJSON', JSON.parse(data));
          }
        });
      } else {
        this.emit('executableOutput', stringValue.replace('[2J[H', ''));
      }
    });

    this.debugprocess.stderr.on('data', (data: Buffer) => {
      this.emit('executableStdErr', data);
    });

    this.debugprocess.on('exit', () => {
      this.emit('debuggerProcessExit');
    });

    this.debugprocess.on('error', (error: Error) => {
      this.emit('terminalError', 'Process failed: ' + error.message);
    });

    this.debugprocess.on('close', () => {
      this.emit('debuggerProcessExit');
    });
  }

  runJestWithUpdateForSnapshots(completion: any, args: string[]) {
    const defaultArgs = ['--updateSnapshot'];
    const updateProcess = this._createProcess(this.workspace, [
      ...defaultArgs,
      ...(args ? args : []),
    ]);
    updateProcess.on('close', () => {
      completion();
    });
  }

  closeProcess() {
    if (!this.debugprocess) {
      return;
    }
    if (process.platform === 'win32') {
      // Windows doesn't exit the process when it should.
      spawn('taskkill', ['/pid', '' + this.debugprocess.pid, '/T', '/F']);
    } else {
      this.debugprocess.kill();
    }
    delete this.debugprocess;
  }
}
