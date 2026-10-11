/*global Ultraviolet*/
window["__uv$config"] = {
  prefix: "/frog/ixl/",
  bare: "/bare/",
  encodeUrl: Ultraviolet.codec.xor.encode,
  decodeUrl: Ultraviolet.codec.xor.decode,
  handler: "/frog/uv.handler.js",
  client: "/frog/uv.client.js",
  bundle: "/frog/uv.bundle.js",
  config: "/frog/uv.config.js",
  sw: "/frog/uv.sw.js",
};
