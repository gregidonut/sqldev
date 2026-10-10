# Build imagorvideo v1.2.0 from the tagged source. The ffmpeg base supplies
# libvips, Poppler, and FFmpeg. The commit check fails the build if the tag moves.
# Animated WebP previews use imagorvideo's gif filter with format(webp); that
# filter is the constrained FFmpeg path and stays behind the signed Imagor URL.
# https://github.com/cshum/imagorvideo/blob/v1.2.0/Dockerfile

ARG GOLANG_VERSION=1.27.1
ARG BASE_IMAGE=ghcr.io/cshum/imagor-base:vips8.18.6-r14-ffmpeg
ARG IMAGORVIDEO_VERSION=v1.2.0
ARG IMAGORVIDEO_COMMIT=e187cf0f1b70af87dd2bbb3eb3925659666f7aa2

FROM golang:${GOLANG_VERSION}-bookworm AS source
ARG IMAGORVIDEO_VERSION
ARG IMAGORVIDEO_COMMIT
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/* \
    && git clone --depth 1 --branch "${IMAGORVIDEO_VERSION}" https://github.com/cshum/imagorvideo.git /src \
    && test "$(git -C /src rev-parse HEAD)" = "${IMAGORVIDEO_COMMIT}"
COPY progress.patch /tmp/progress.patch
RUN git -C /src apply /tmp/progress.patch

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
RUN CGO_CFLAGS_ALLOW=-Xpreprocessor go build -ldflags "-s -w" -o /opt/imagor/bin/imagorvideo ./cmd/imagorvideo/main.go

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
COPY --from=builder /opt/imagor/bin/imagorvideo /opt/imagor/bin/imagorvideo
RUN ln -s /opt/imagor/bin/imagorvideo /usr/local/bin/imagorvideo
ENV VIPS_WARNING=0
ENV MALLOC_ARENA_MAX=2
ENV LD_PRELOAD=/usr/local/lib/libjemalloc.so
ENV LD_LIBRARY_PATH=/opt/imagor/lib
ENV FONTCONFIG_PATH=/etc/fonts
ENV XDG_CACHE_HOME=/tmp
ENV VIPS_VECTOR=167772160
ENV PORT=8000
USER nobody
ENTRYPOINT ["/usr/local/bin/imagorvideo"]
EXPOSE 8000
