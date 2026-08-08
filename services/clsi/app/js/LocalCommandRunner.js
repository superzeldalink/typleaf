/* eslint-disable
    no-return-assign,
    no-unused-vars,
*/
// TODO: This file was created by bulk-decaffeinate.
// Fix any style issues and re-enable lint.
/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
import { spawn } from 'node:child_process'
import { promisify } from 'node:util'
import Path from 'node:path'
import _ from 'lodash'
import logger from '@overleaf/logger'
let CommandRunner

logger.debug('using standard command runner')

// Track PIDs that have been intentionally killed so that the close handler
// can detect termination even when the child exits with a numeric code instead
// of being reported as killed by a signal (e.g. exit code 4 from latexmk).
const killedPids = new Set()

export default CommandRunner = {
  run(
    projectId,
    command,
    directory,
    image,
    timeout,
    environment,
    compileGroup,
    cwd,
    callback
  ) {
    let key, value
    callback = _.once(callback)
    const spawnCwd = cwd ? Path.join(directory, cwd) : directory
    command = Array.from(command).map(arg =>
      arg.toString().replace('$COMPILE_DIR', directory)
    )
    logger.debug(
      { projectId, command, directory, cwd: spawnCwd },
      'running command'
    )
    logger.warn('timeouts and sandboxing are not enabled with CommandRunner')

    // merge environment settings
    const env = {}
    for (key in process.env) {
      value = process.env[key]
      env[key] = value
    }
    for (key in environment) {
      value = environment[key]
      env[key] = value
    }

    // run command as detached process so it has its own process group (which can be killed if needed)
    const proc = spawn(command[0], command.slice(1), {
      cwd: spawnCwd,
      env,
      // stderr was 'ignore', which silently threw away everything typst
      // reports -- it writes no log file and puts all diagnostics on stderr,
      // so a failed compile reached the editor with nothing to show. The
      // docker runner captures both streams; this keeps them in step.
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    })

    let stdout = ''
    let stderr = ''
    proc.stdout.setEncoding('utf8').on('data', data => (stdout += data))
    proc.stderr.setEncoding('utf8').on('data', data => (stderr += data))

    proc.on('error', function (err) {
      killedPids.delete(proc.pid)
      logger.err(
        { err, projectId, command, directory },
        'error running command'
      )
      return callback(err)
    })

    proc.on('close', function (code, signal) {
      let err
      logger.debug({ code, signal, projectId }, 'command exited')
      const wasKilled = killedPids.delete(proc.pid)
      // The output is handed back alongside the error too: a failed compile is
      // exactly when its log is worth reading, and callers that only care
      // about the error can still ignore the second argument.
      if (signal === 'SIGTERM' || wasKilled) {
        err = new Error('terminated')
        err.terminated = true
        return callback(err, { stdout, stderr, exitCode: code })
      } else if (code === 1) {
        // exit status from chktex
        err = new Error('exited')
        err.code = code
        return callback(err, { stdout, stderr, exitCode: code })
      } else {
        return callback(null, { stdout, stderr, exitCode: code })
      }
    })

    return proc.pid
  }, // return process id to allow job to be killed if necessary

  kill(pid, callback) {
    if (callback == null) {
      callback = function () {}
    }
    try {
      killedPids.add(pid)
      process.kill(-pid) // kill all processes in group
    } catch (err) {
      killedPids.delete(pid)
      return callback(err)
    }
    return callback()
  },

  canRunSyncTeXInOutputDir() {
    return true
  },
}

CommandRunner.promises = {
  run: promisify(CommandRunner.run),
  kill: promisify(CommandRunner.kill),
}
