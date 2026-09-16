import { emptyBucket } from "@sqldev/core/s3";

emptyBucket().then(
  ({ deleted }) => {
    console.log(`deleted ${deleted} objects`);
    process.exit(0);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
