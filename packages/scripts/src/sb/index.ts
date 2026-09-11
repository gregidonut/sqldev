import { runSupabase } from "@sqldev/core/envBuilder";
import { chdir } from "process";

chdir("../backend");
runSupabase(process.argv.slice(2)).then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
