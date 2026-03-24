import builder, {cmd} from "@sqldev/core/envBuilder";
import {chdir} from "process";

function assertArg(value: string): cmd {
    if (!Object.values(cmd).includes(value as cmd)) {
        throw new Error(`Invalid arg: ${value}`);
    }
    return value as cmd;
}

const c = assertArg(process.argv.slice(2)[0]);

chdir("../backend");
builder(c);
