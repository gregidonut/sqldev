import builder, { cmd } from "@sqldev/core/envBuilder";
import { chdir } from "process";

function assertArg(value: string): cmd {
  if (!Object.values(cmd).includes(value as cmd)) {
    throw new Error(`Invalid arg: ${value}`);
  }
  return value as cmd;
}

const c: [cmd] | [cmd, string] = !(process.argv.slice(2)[0] === cmd.migration)
  ? [assertArg(process.argv.slice(2)[0])]
  : [assertArg(process.argv.slice(2)[0]), process.argv.slice(2)[1]];

chdir("../backend");
builder(c);
