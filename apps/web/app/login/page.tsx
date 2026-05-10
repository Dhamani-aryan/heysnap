import { WebCloudApp } from "../cloud-app-client";

const cloudServerUrl = process.env.NEXT_PUBLIC_CLOUD_SERVER_URL?.trim() || "https://api.heysnap.xyz";

export default function LoginPage() {
  return <WebCloudApp cloudServerUrl={cloudServerUrl} route={{ view: "login" }} />;
}
