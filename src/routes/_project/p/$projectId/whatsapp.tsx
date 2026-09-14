import { createFileRoute } from "@tanstack/react-router";
import { WhatsappPage } from "@/client/features/whatsapp/WhatsappPage";

export const Route = createFileRoute("/_project/p/$projectId/whatsapp")({
  component: WhatsappRoute,
});

function WhatsappRoute() {
  const { projectId } = Route.useParams();
  return <WhatsappPage projectId={projectId} />;
}
