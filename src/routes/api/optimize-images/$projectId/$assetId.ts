import { createFileRoute } from "@tanstack/react-router";
import { loadImage } from "@/server/features/optimize/optimizeImages";

// Serves an article image the app stored for an Optimize recommendation, for
// the in-app article preview. Unauthenticated like any image on a website: the
// asset id is a random UUID, the images are headed for a public post anyway,
// and only raster types are ever stored. The headers stop a browser treating
// the bytes as anything but an image.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handleImageRequest(projectId: string, assetId: string): Promise<Response> {
  if (!UUID.test(projectId) || !UUID.test(assetId)) {
    return new Response("Not found", { status: 404 });
  }
  const image = await loadImage(projectId, assetId);
  if (!image || !image.contentType.startsWith("image/")) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(image.bytes, {
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

export const Route = createFileRoute("/api/optimize-images/$projectId/$assetId")({
  server: {
    handlers: {
      GET: async ({ params }: { params: { projectId: string; assetId: string } }) =>
        handleImageRequest(params.projectId, params.assetId),
    },
  },
});
