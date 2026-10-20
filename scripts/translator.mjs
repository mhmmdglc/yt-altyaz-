#!/usr/bin/env node
// npm run translator -- start|stop|restart|status|logs|test [lang]
// Manages the local translation server (llama-server running HY-MT). It listens on 127.0.0.1 only.
import { readFileSync } from 'node:fs';
import { TRANSLATOR } from '../config.js';
import { startServer, stopServer, isUp, logFile, translate, modelInstalled } from '../translator.js';

const [cmd = 'status', arg] = process.argv.slice(2);
const fail = (e) => { console.error(`✗ ${e.message}`); process.exit(1); };

switch (cmd) {
  case 'start':
    await startServer().then((r) => console.log(r.started ? `✓ Started: ${TRANSLATOR.url} (pid ${r.pid})` : `✓ Already running: ${TRANSLATOR.url}`)).catch(fail);
    break;
  case 'stop':
    console.log((await stopServer()) ? '✓ Stopped.' : 'Not running (no process started by this tool).');
    break;
  case 'restart':
    await stopServer();
    await new Promise((r) => setTimeout(r, 1000));
    await startServer().then((r) => console.log(`✓ Started: ${TRANSLATOR.url} (pid ${r.pid})`)).catch(fail);
    break;
  case 'status':
    console.log(`model:  ${modelInstalled() ? `installed (${TRANSLATOR.modelPath})` : 'not installed'}`);
    console.log(`server: ${(await isUp()) ? `running at ${TRANSLATOR.url}` : 'not running'}`);
    break;
  case 'logs':
    try { console.log(readFileSync(logFile, 'utf8').split('\n').slice(-50).join('\n')); } catch { console.log('No log yet.'); }
    break;
  case 'test': {
    await startServer().catch(fail);
    const lang = arg || 'tr';
    console.log(await translate('The cool thing about these guys is that they have really long trunks.', lang).catch(fail));
    break;
  }
  default:
    console.error('Usage: npm run translator -- start|stop|restart|status|logs|test [language-code]');
    process.exit(2);
}
