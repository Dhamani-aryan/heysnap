import { WebCloudApp } from "../../cloud-app-client";

const cloudServerUrl = process.env.NEXT_PUBLIC_CLOUD_SERVER_URL?.trim() || "https://api.heysnap.xyz";

export default async function MachinePage({
  params,
}: {
  readonly params: Promise<{ readonly computerId: string }>;
}) {
  const { computerId } = await params;

  return (
    <WebCloudApp
      cloudServerUrl={cloudServerUrl}
      route={{ view: "workspace", computerId, threadId: null }}
    />
  );
}
