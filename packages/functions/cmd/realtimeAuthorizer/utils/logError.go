package utils

import (
	"errors"
	"fmt"

	"github.com/golang-jwt/jwt/v5"
)

func LogJWTError(err error) {
	if errors.Is(err, jwt.ErrTokenExpired) {
		fmt.Println("JWT Verification failed: TokenExpiredError: jwt expired")
		return
	}
	fmt.Printf("JWT Verification failed: %v\n", err)
}
