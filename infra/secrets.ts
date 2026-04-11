export const astroAppDomain = new sst.Secret("AstroAppDomain", "");
export const feAcmCertArn = new sst.Secret("FeAcmCertArn", "");
export const clerkPublic = new sst.Secret("ClerkPublicKey", "");
export const clerkSecret = new sst.Secret("ClerkSecretKey", "");
export const clerkFeDomain = new sst.Secret("ClerkFeDomain", "");
export const supabaseKey = new sst.Secret("SupabaseKey", "");
export const supabaseUrl = new sst.Secret(
  "SupabaseUrl",
  "http://localhost:54321",
);
export const clerkJWKSPublicKey = new sst.Secret("ClerkJWKSPublicKey", "");
