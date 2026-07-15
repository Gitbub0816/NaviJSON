import type { Metadata } from "next";
import { NaviMap } from "./NaviMap";

export const metadata: Metadata = {
  title: "California Light",
  description:
    "Explore the Mapbox-compatible NaviJSON California Light GeoJSON style.",
};

export default function CaliforniaLightPage() {
  return <NaviMap mapboxToken={process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? ""} />;
}
