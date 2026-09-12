import { Router } from "express";
import { getRuntimeAssets } from "../sandbox/runtimeAssets";

/** Serves the content-hashed React/Tailwind/bridge bundles that every generated-app page loads. */
export function runtimeRouter() {
  const router = Router();

  router.get("/runtime/:file", async (req, res) => {
    const assets = await getRuntimeAssets();
    const asset = assets.files.get(req.params.file);
    if (!asset) {
      res.status(404).end();
      return;
    }
    res.set({
      "Content-Type": asset.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      // Loaded with crossorigin="anonymous" from opaque-origin (sandboxed) pages.
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
    res.send(asset.body);
  });

  return router;
}
