import { runSupabase } from "@sqldev/core/envBuilder";
import { chdir } from "process";

chdir("../backend");
runSupabase(process.argv.slice(2));
