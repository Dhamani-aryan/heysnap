import { MachineWorkspaceRoute } from "./machine-workspace-route";

const cloudServerUrl = process.env.NEXT_PUBLIC_CLOUD_SERVER_URL?.trim() || "https://api.heysnap.xyz";

export default async function MachineLayout({
  children,
  params,
}: {
  readonly children: React.ReactNode;
  readonly params: Promise<{ readonly computerId: string }>;
}) {
  const { computerId } = await params;

  return (
    <>
      <MachineWorkspaceRoute cloudServerUrl={cloudServerUrl} computerId={computerId} />
      {children}
    </>
  );
}
