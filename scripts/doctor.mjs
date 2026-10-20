#!/usr/bin/env node
// npm run doctor — shows what is installed and what is missing.
import { checkEnvironment, printChecks, platformInstallHelp } from './lib/checks.mjs';

const results = checkEnvironment();
console.log('\nYT Altyazı — environment check\n');
printChecks(results);
const missing = results.filter((r) => !r.ok && r.required);
const missingTools = missing.filter((r) => r.name !== 'Whisper model');
if (missingTools.length) {
  const help = platformInstallHelp();
  console.log(`\nInstall the missing tools:\n\n  ${help.command}\n${help.note ? `\n  ${help.note}\n` : ''}\nThen run: npm run setup`);
  process.exit(1);
}
if (missing.length) {
  console.log('\nThe tools are installed; the Whisper model is still missing. Run: npm run setup\n');
  process.exit(1);
}
console.log('\nEverything required is installed. Start the app with: npm start\n');
