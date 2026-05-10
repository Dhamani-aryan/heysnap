import { WebCloudApp } from "../../../cloud-app-client";

const cloudServerUrl = process.env.NEXT_PUBLIC_CLOUD_SERVER_URL?.trim() || "https://api.heysnap.xyz";

export default async function MachineThreadPage({
  params,
}: {
  readonly params: Promise<{ readonly computerId: string; readonly threadId: string }>;
}) {
  const { computerId, threadId } = await params;

  return (
    <WebCloudApp
      cloudServerUrl={cloudServerUrl}
      route={{ view: "workspace", computerId, threadId }}
    />
  );
}
