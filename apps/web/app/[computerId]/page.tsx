import { CloudApp } from "@ank1015-app/ui";

const cloudServerUrl = process.env.NEXT_PUBLIC_CLOUD_SERVER_URL?.trim() || "https://api.heysnap.xyz";

export default async function MachinePage({
  params,
}: {
  readonly params: Promise<{ readonly computerId: string }>;
}) {
  const { computerId } = await params;

  return (
    <CloudApp
      cloudServerUrl={cloudServerUrl}
      includeLocalMachine={false}
      initialComputerId={computerId}
      machineRouteBasePath="/"
      storageKey="ank1015:web-session-token"
    />
  );
}
