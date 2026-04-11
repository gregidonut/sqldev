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
  ],
  environment: {
    PUBLIC_APP_STAGE: $app.stage,
    ASTRO_SITE: astroAppDomain.value,
    CLERK_JWKS_PUBLIC_KEY: clerkJWKSPublicKey.value,
    PUBLIC_CLERK_PUBLISHABLE_KEY: clerkPublic.value,
    CLERK_SECRET_KEY: clerkSecret.value,
    PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
    SUPABASE_URL: supabaseUrl.value,
    SUPABASE_KEY: supabaseKey.value,
  },
  domain: {
    name: astroAppDomain.value,
    dns: false,
    cert: feAcmCertArn.value,
  },
  vpc: ["dev"].includes($app.stage) ? undefined : SupabaseVPC,
});
