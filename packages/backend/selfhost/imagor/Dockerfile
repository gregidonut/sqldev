# Build imagor v1.9.7 from the tagged source. The base image supplies libvips;
# the commit check fails the build if the tag moves.
# https://github.com/cshum/imagor/blob/v1.9.7/Dockerfile

ARG GOLANG_VERSION=1.27.1
ARG BASE_IMAGE=ghcr.io/cshum/imagor-base:vips8.18.6-r14
ARG IMAGOR_VERSION=v1.9.7
ARG IMAGOR_COMMIT=0daee13ecec5df896f15aef91fcbbb0c87aac935

FROM golang:${GOLANG_VERSION}-bookworm AS source
ARG IMAGOR_VERSION
ARG IMAGOR_COMMIT
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/* \
    && git clone --depth 1 --branch "${IMAGOR_VERSION}" https://github.com/cshum/imagor.git /src \
    && test "$(git -C /src rev-parse HEAD)" = "${IMAGOR_COMMIT}"

FROM ${BASE_IMAGE} AS native-base

FROM ${BASE_IMAGE}-dev AS builder
COPY --from=source /usr/local/go /usr/local/go
ENV GOPATH=/go
ENV PATH=/usr/local/go/bin:/go/bin:$PATH
ENV CGO_ENABLED=1
ENV PKG_CONFIG_PATH=/opt/imagor/lib/pkgconfig
ENV CGO_CFLAGS=-I/opt/imagor/include
ENV CGO_LDFLAGS="-L/opt/imagor/lib -Wl,-rpath,/opt/imagor/lib"
WORKDIR /src
COPY --from=source /src/go.mod /src/go.sum ./
RUN go mod download
COPY --from=source /src ./
RUN CGO_CFLAGS_ALLOW=-Xpreprocessor go build -ldflags "-s -w" -o /opt/imagor/bin/imagor ./cmd/imagor/main.go

FROM native-base AS runtime
RUN apt-get update \
    && apt-get upgrade -y \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        curl \
        media-types \
    && ln -s /usr/lib/$(uname -m)-linux-gnu/libjemalloc.so.2 /usr/local/lib/libjemalloc.so \
    && mkdir -p /var/cache/fontconfig \
    && chmod 777 /var/cache/fontconfig \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /etc/fonts/conf.d/10-sub-pixel-rgb.conf /etc/fonts/conf.d/11-lcdfilter-default.conf
COPY --from=builder /opt/imagor/bin/imagor /opt/imagor/bin/imagor
RUN ln -s /opt/imagor/bin/imagor /usr/local/bin/imagor
ENV VIPS_WARNING=0
ENV MALLOC_ARENA_MAX=2
ENV LD_PRELOAD=/usr/local/lib/libjemalloc.so
ENV LD_LIBRARY_PATH=/opt/imagor/lib
ENV FONTCONFIG_PATH=/etc/fonts
ENV XDG_CACHE_HOME=/tmp
ENV VIPS_VECTOR=167772160
ENV PORT=8000
USER nobody
ENTRYPOINT ["/usr/local/bin/imagor"]
EXPOSE 8000
