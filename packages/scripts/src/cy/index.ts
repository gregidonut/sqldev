import { runCypress } from "@sqldev/core/envBuilder";
import { chdir } from "process";

chdir("../e2et");
runCypress(process.argv.slice(2));
