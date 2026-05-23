package utils

import (
	"errors"
	"fmt"

	"github.com/golang-jwt/jwt/v5"
)

func VerifyClerkJWT(tokenStr, publicKey string) error {
	parsed, err := jwt.Parse(tokenStr, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return jwt.ParseRSAPublicKeyFromPEM([]byte(publicKey))
	}, jwt.WithLeeway(JwtLeeway))
	if err != nil {
		return err
	}

	claims, ok := parsed.Claims.(jwt.MapClaims)
	if !ok || !parsed.Valid {
		return errors.New("invalid token claims")
	}

	role, _ := claims["role"].(string)
	if role != "authenticated" {
		return errors.New("invalid role")
	}

	return nil
}
