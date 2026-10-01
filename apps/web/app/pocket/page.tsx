"use client";

import { PocketPanel } from "../../features/pocket/PocketPanel";
import type { MainSigner } from "@stockx/shared/pocket";

export default function PocketPage() {
  const getMainSigner = async (): Promise<MainSigner> => {
    throw new Error("TODO A: replace this with the shared wallet context.");
  };

  return (
    <>
      <p>TODO A: replace this with the shared wallet context.</p>
      <PocketPanel mainAddress="" getMainSigner={getMainSigner} executor={null} />
    </>
  );
}