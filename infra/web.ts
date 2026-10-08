import {
  astroAppDomain,
  feAcmCertArn,
  clerkPublic,
  clerkSecret,
  clerkJWKSPublicKey,
  supabaseKey,
  supabaseUrl,
} from "./secrets";
import { Vpc as SupabaseVPC } from "./vpc";
import { realtime } from "./realtime";
import { api } from "./api";
import { bucket } from "./storage";

export const frontend = new sst.aws.Astro("Frontend", {
  path: "packages/frontend",
  link: [
    astroAppDomain,
    feAcmCertArn,
    clerkPublic,
    clerkSecret,
    supabaseKey,
    supabaseUrl,
    clerkJWKSPublicKey,
    realtime,
    api,
    bucket,
  ],
  environment: {
    PUBLIC_APP_STAGE: $app.stage,
    ASTRO_SITE: astroAppDomain.value,
    CLERK_JWKS_PUBLIC_KEY: clerkJWKSPublicKey.value,
    PUBLIC_CLERK_PUBLISHABLE_KEY: clerkPublic.value,
    CLERK_SECRET_KEY: clerkSecret.value,
    PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
    PUBLIC_CLERK_TELEMETRY_DISABLED: "true",
    SUPABASE_URL: supabaseUrl.value,
    SUPABASE_KEY: supabaseKey.value,
  },
  domain: {
    name: astroAppDomain.value,
    dns: false,
    cert: feAcmCertArn.value,
  },
  vpc: ["dev"].includes($app.stage) ? undefined : SupabaseVPC,
  server: {
    runtime: "nodejs22.x",
  },
});
