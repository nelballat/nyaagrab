import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("No command provided.");
  process.exit(1);
}

const cargoBin = `${homedir()}\\.cargo\\bin`;
const localBin = join(process.cwd(), "node_modules", ".bin");
const env = { ...process.env };
const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
const currentPath = env[pathKey] ?? "";
const segments = currentPath.split(delimiter);
const executableExtensions = process.platform === "win32" ? [".cmd", ".exe", ".bat", ""] : [""];

if (existsSync(localBin) && !segments.includes(localBin)) {
  segments.unshift(localBin);
}

if (existsSync(cargoBin) && !segments.includes(cargoBin)) {
  segments.unshift(cargoBin);
}

env[pathKey] = segments.join(delimiter);

function resolveCommand(command) {
  if (command.includes("\\") || command.includes("/")) {
    return command;
  }

  for (const segment of segments) {
    if (!segment) {
      continue;
    }
    for (const extension of executableExtensions) {
      const candidate = join(segment, `${command}${extension}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return command;
}

function quoteForCmd(argument) {
  if (argument.length === 0) {
    return '""';
  }
  if (!/[\s"&<>^|()]/.test(argument)) {
    return argument;
  }
  return `"${argument.replace(/"/g, '""')}"`;
}

const resolvedCommand = resolveCommand(args[0]);
const needsCmdShim = process.platform === "win32" && /\.(cmd|bat)$/i.test(resolvedCommand);

const child = needsCmdShim
  ? spawn(process.env.comspec ?? "cmd.exe", [
      "/d",
      "/s",
      "/c",
      [quoteForCmd(resolvedCommand), ...args.slice(1).map(quoteForCmd)].join(" ")
    ], {
      stdio: "inherit",
      shell: false,
      env
    })
  : spawn(resolvedCommand, args.slice(1), {
      stdio: "inherit",
      shell: false,
      env
    });

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
