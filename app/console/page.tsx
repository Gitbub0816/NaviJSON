import type { Metadata } from "next";
import { Console } from "./Console";

export const metadata: Metadata = {
  title: "Developer Console",
  description:
    "Manage NaviJSON API keys, monitor usage, and meter requests against Cloudflare D1.",
};

export default function ConsolePage() {
  return <Console />;
}
