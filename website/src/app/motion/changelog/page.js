import Changelog from "../../changelog/Changelog";

export const dynamic = 'force-static';

export const metadata = {
  title: "Motion Changelog — AutoFlow Motion Release Notes",
  description:
    "Every AutoFlow Motion release: motion control for Google Flow, replace people and items, lip sync, landscape output and fixes.",
  alternates: {
    canonical: "https://www.auto-flow.studio/motion/changelog",
  },
};

export default function MotionChangelogPage() {
  return <Changelog product="motion" />;
}
