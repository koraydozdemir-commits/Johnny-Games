/*global Ultraviolet*/
self["__uv$config"] = {
  prefix: "/frog/ixl/",
  bare: "/bare/",
  encodeUrl: Ultraviolet.codec.base64.encode,
  decodeUrl: Ultraviolet.codec.base64.decode,
  handler: "/frog/uv.handler.js",
  client: "/frog/uv.client.js",
  bundle: "/frog/uv.bundle.js",
  config: "/frog/uv.config.js",
  sw: "/frog/uv.sw.js",
};
