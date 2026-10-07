package api

import (
	"context"
	"net/http"
)

func (s *Server) GetClerkUser(ctx context.Context, request GetClerkUserRequestObject) (GetClerkUserResponseObject, error) {
	if _, err := s.authenticate(ctx); err != nil {
		return userFailure(err), nil
	}
	if request.UserId == "" {
		return userFailure(errBadRequest), nil
	}
	record, err := s.Profiles.Get(ctx, request.UserId)
	if err != nil {
		return userFailure(err), nil
	}
	return GetClerkUser200JSONResponse{
		Id:       record.ID,
		Username: record.Username,
		ImageUrl: record.ImageURL,
	}, nil
}

func userFailure(err error) GetClerkUserResponseObject {
	status, message := classify(err)
	switch status {
	case http.StatusUnauthorized:
		return GetClerkUser401JSONResponse{UnauthorizedJSONResponse: UnauthorizedJSONResponse{Message: message}}
	case http.StatusNotFound:
		return GetClerkUser404JSONResponse{NotFoundJSONResponse: NotFoundJSONResponse{Message: message}}
	default:
		return GetClerkUser500JSONResponse{InternalErrorJSONResponse: InternalErrorJSONResponse{Message: message}}
	}
}
