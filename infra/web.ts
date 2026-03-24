import {
  astroAppDomain,
  feAcmCertArn,
  clerkPublic,
  clerkSecret,
  supabaseKey,
  supabaseUrl,
} from "./secrets";
import { Vpc as SupabaseVPC } from "./vpc";

export const frontend = new sst.aws.Astro("Frontend", {
  path: "packages/frontend",
  link: [astroAppDomain, feAcmCertArn, supabaseKey, supabaseUrl],
  environment: {
    PUBLIC_APP_STAGE: $app.stage,
    ASTRO_SITE: astroAppDomain.value,
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
  vpc: ["dev", "staging"].includes($app.stage) ? undefined : SupabaseVPC,
});
