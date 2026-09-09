import { Workshop } from "../../workshop";
export default async function Approval({ params }: { params: Promise<{ id: string }> }) {
  return <Workshop approvalId={(await params).id} />;
}
