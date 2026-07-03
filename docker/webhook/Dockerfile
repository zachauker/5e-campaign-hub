# Builds adnanh/webhook (https://github.com/adnanh/webhook) from source
# rather than pulling a pre-built third-party image, so it's clear exactly
# what's running in a container that has Docker socket access.
FROM golang:1.22-alpine AS build
WORKDIR /src
RUN apk add --no-cache git
RUN git clone --depth 1 https://github.com/adnanh/webhook.git .
RUN go build -o /webhook .

FROM alpine:latest
RUN apk add --no-cache docker-cli docker-cli-compose git openssh-client ca-certificates
COPY --from=build /webhook /usr/local/bin/webhook
ENTRYPOINT ["webhook"]
CMD ["-hooks=/etc/webhook/hooks.json", "-template", "-verbose", "-port=9000"]
