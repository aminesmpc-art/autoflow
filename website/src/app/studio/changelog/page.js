import Changelog from "../../changelog/Changelog";

export const dynamic = 'force-static';

export const metadata = {
  title: "Studio Changelog — AutoFlow Studio Release Notes",
  description:
    "Every AutoFlow Studio release: new nodes, platforms, templates, community workflows and fixes.",
  alternates: {
    canonical: "https://www.auto-flow.studio/studio/changelog",
  },
};

export default function StudioChangelogPage() {
  return <Changelog product="studio" />;
}
