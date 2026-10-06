import { redirect } from "next/navigation";

/**
 * Retired route. The documents a student uploads are their Certificate of
 * Registration and rating slips, which Academic Records already handles,
 * with the verification status the OSA records against each one. A second,
 * unbuilt file screen beside it only split the same job in two.
 */
export default function DocumentsPage() {
  redirect("/records");
}
