import { notFound } from "next/navigation";
import { getStock } from "@stockx/shared";
import StockView from "../../../components/StockView";

export default async function StockPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const stock = getStock(slug);
  if (!stock || stock.status !== "live") notFound();
  return <StockView stock={stock} />;
}