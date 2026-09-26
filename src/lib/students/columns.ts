/**
 * The column lists this app selects from `students`, kept in one place so
 * columns.test.ts can check every one against the schema the migrations
 * actually produce.
 *
 * 00006 dropped `students.section` along with the enrollment module. Four
 * queries went on selecting it; PostgREST rejects a query that names a
 * missing column, so the concern detail page, the student record and the
 * student directory each failed outright, and profile setup failed for
 * any student whose enrollment list carried a section.
 *
 * Section still exists on account_invitations — the registrar's record of
 * what the enrollment list said — but it is not part of a student row.
 */

/** Staff record page: only what an officer acts on (RA 10173 minimisation). */
export const RECORD_PROFILE_COLUMNS =
  "id, user_id, student_number, first_name, middle_name, last_name, name_extension, program, department, year_level, campus, scholastic_status, cellphone, email_address, is_pwd, is_indigenous, is_listahan";

/** Student directory rows. */
export const DIRECTORY_COLUMNS =
  "id, student_number, first_name, last_name, program, year_level, scholastic_status";

/** The student embedded in a concern's detail view. */
export const CONCERN_STUDENT_COLUMNS =
  "id, first_name, last_name, student_number, email_address, cellphone, program, year_level";
