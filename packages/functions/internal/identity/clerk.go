// Package identity verifies Clerk session JWTs before work is queued.
package identity

import (
	"crypto/rsa"
	"errors"
	"fmt"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gregidonut/sqldev/packages/functions/internal/jobs"
)

type Verifier struct {
	key    *rsa.PublicKey
	leeway jwt.ParserOption
}

func New(pem string) (*Verifier, error) {
	key, err := jwt.ParseRSAPublicKeyFromPEM([]byte(pem))
	if err != nil {
		return nil, fmt.Errorf("parse clerk public key: %w", err)
	}
	return &Verifier{key: key, leeway: jwt.WithLeeway(0)}, nil
}

func (v *Verifier) Verify(token string) (jobs.Claims, error) {
	if v == nil || v.key == nil {
		return jobs.Claims{}, errors.New("clerk verifier is not configured")
	}
	parsed, err := jwt.Parse(token, func(unverified *jwt.Token) (any, error) {
		if _, ok := unverified.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", unverified.Header["alg"])
		}
		return v.key, nil
	}, v.leeway)
	if err != nil {
		return jobs.Claims{}, err
	}
	claims, ok := parsed.Claims.(jwt.MapClaims)
	if !ok || !parsed.Valid {
		return jobs.Claims{}, errors.New("invalid token claims")
	}
	subject, _ := claims["sub"].(string)
	role, _ := claims["role"].(string)
	if subject == "" {
		return jobs.Claims{}, errors.New("token subject is required")
	}
	if role != "authenticated" {
		return jobs.Claims{}, errors.New("invalid role")
	}
	return jobs.Claims{Subject: subject, Role: role}, nil
}
