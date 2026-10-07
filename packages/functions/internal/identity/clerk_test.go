package identity

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestVerifyAcceptsAuthenticatedClerkToken(t *testing.T) {
	key, token := sign(t, jwt.MapClaims{
		"sub":  "user_123",
		"role": "authenticated",
		"exp":  time.Now().Add(time.Minute).Unix(),
	})
	verifier, err := New(publicPEM(t, &key.PublicKey))
	if err != nil {
		t.Fatal(err)
	}
	claims, err := verifier.Verify(token)
	if err != nil {
		t.Fatal(err)
	}
	if claims.Subject != "user_123" || claims.Role != "authenticated" {
		t.Fatalf("claims = %+v", claims)
	}
}

func TestVerifyRejectsWrongRole(t *testing.T) {
	key, token := sign(t, jwt.MapClaims{
		"sub":  "user_123",
		"role": "anon",
		"exp":  time.Now().Add(time.Minute).Unix(),
	})
	verifier, err := New(publicPEM(t, &key.PublicKey))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := verifier.Verify(token); err == nil {
		t.Fatal("expected the role to be rejected")
	}
}

func sign(t *testing.T, claims jwt.MapClaims) (*rsa.PrivateKey, string) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodRS256, claims).SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return key, token
}

func publicPEM(t *testing.T, key *rsa.PublicKey) string {
	t.Helper()
	der, err := x509.MarshalPKIXPublicKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}))
}
