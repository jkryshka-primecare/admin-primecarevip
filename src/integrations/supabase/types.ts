export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          created_at: string
          id: string
          ip_address: string | null
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      cpt_codes: {
        Row: {
          category: string
          code: string
          created_at: string
          description: string
          status: string | null
          updated_at: string
        }
        Insert: {
          category: string
          code: string
          created_at?: string
          description: string
          status?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          code?: string
          created_at?: string
          description?: string
          status?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      dispense_records: {
        Row: {
          created_at: string
          date_written: string | null
          days_supply: number | null
          dea_schedule: string | null
          diagnosis_code: string | null
          directions: string | null
          dispensed_at: string
          dispensed_by: string | null
          hint_billed_at: string | null
          hint_billing_error: string | null
          hint_billing_status: string | null
          hint_charge_id: string | null
          hint_patient_id: string | null
          hint_voided_at: string | null
          hint_voided_by: string | null
          id: string
          lot_number: string | null
          medication_id: string | null
          medication_name: string
          notes: string | null
          patient_address: string | null
          patient_dob: string | null
          patient_name: string
          patient_phone: string | null
          pharmacist_license: string | null
          prescriber: string | null
          prescriber_dea: string | null
          prescriber_npi: string | null
          prescriber_phone: string | null
          prescription_queue_id: string | null
          quantity: number
          refill_number: number | null
          refills_authorized: number | null
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          rx_number: string | null
          stock_returned_at: string | null
          total_cost: number | null
          unit_price: number | null
        }
        Insert: {
          created_at?: string
          date_written?: string | null
          days_supply?: number | null
          dea_schedule?: string | null
          diagnosis_code?: string | null
          directions?: string | null
          dispensed_at?: string
          dispensed_by?: string | null
          hint_billed_at?: string | null
          hint_billing_error?: string | null
          hint_billing_status?: string | null
          hint_charge_id?: string | null
          hint_patient_id?: string | null
          hint_voided_at?: string | null
          hint_voided_by?: string | null
          id?: string
          lot_number?: string | null
          medication_id?: string | null
          medication_name: string
          notes?: string | null
          patient_address?: string | null
          patient_dob?: string | null
          patient_name: string
          patient_phone?: string | null
          pharmacist_license?: string | null
          prescriber?: string | null
          prescriber_dea?: string | null
          prescriber_npi?: string | null
          prescriber_phone?: string | null
          prescription_queue_id?: string | null
          quantity: number
          refill_number?: number | null
          refills_authorized?: number | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          rx_number?: string | null
          stock_returned_at?: string | null
          total_cost?: number | null
          unit_price?: number | null
        }
        Update: {
          created_at?: string
          date_written?: string | null
          days_supply?: number | null
          dea_schedule?: string | null
          diagnosis_code?: string | null
          directions?: string | null
          dispensed_at?: string
          dispensed_by?: string | null
          hint_billed_at?: string | null
          hint_billing_error?: string | null
          hint_billing_status?: string | null
          hint_charge_id?: string | null
          hint_patient_id?: string | null
          hint_voided_at?: string | null
          hint_voided_by?: string | null
          id?: string
          lot_number?: string | null
          medication_id?: string | null
          medication_name?: string
          notes?: string | null
          patient_address?: string | null
          patient_dob?: string | null
          patient_name?: string
          patient_phone?: string | null
          pharmacist_license?: string | null
          prescriber?: string | null
          prescriber_dea?: string | null
          prescriber_npi?: string | null
          prescriber_phone?: string | null
          prescription_queue_id?: string | null
          quantity?: number
          refill_number?: number | null
          refills_authorized?: number | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          rx_number?: string | null
          stock_returned_at?: string | null
          total_cost?: number | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "dispense_records_prescription_queue_id_fkey"
            columns: ["prescription_queue_id"]
            isOneToOne: false
            referencedRelation: "prescription_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      hr_attendance_records: {
        Row: {
          clock_in: string | null
          clock_out: string | null
          created_at: string
          date: string
          employee_id: string
          hours_worked: number | null
          id: string
          notes: string | null
          status: Database["public"]["Enums"]["hr_attendance_status"]
        }
        Insert: {
          clock_in?: string | null
          clock_out?: string | null
          created_at?: string
          date: string
          employee_id: string
          hours_worked?: number | null
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["hr_attendance_status"]
        }
        Update: {
          clock_in?: string | null
          clock_out?: string | null
          created_at?: string
          date?: string
          employee_id?: string
          hours_worked?: number | null
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["hr_attendance_status"]
        }
        Relationships: [
          {
            foreignKeyName: "hr_attendance_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_certifications: {
        Row: {
          created_at: string
          document_name: string | null
          document_url: string | null
          employee_id: string
          expiration_date: string | null
          id: string
          issue_date: string | null
          issuing_authority: string | null
          last_notified_date: string | null
          license_number: string | null
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          document_name?: string | null
          document_url?: string | null
          employee_id: string
          expiration_date?: string | null
          id?: string
          issue_date?: string | null
          issuing_authority?: string | null
          last_notified_date?: string | null
          license_number?: string | null
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_name?: string | null
          document_url?: string | null
          employee_id?: string
          expiration_date?: string | null
          id?: string
          issue_date?: string | null
          issuing_authority?: string | null
          last_notified_date?: string | null
          license_number?: string | null
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_certifications_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_contractors: {
        Row: {
          address: string | null
          company_name: string | null
          contract_number: string | null
          created_at: string
          department_id: string | null
          email: string
          end_date: string | null
          first_name: string
          id: string
          last_name: string
          notes: string | null
          phone: string | null
          rate: number | null
          rate_type:
            | Database["public"]["Enums"]["hr_contractor_rate_type"]
            | null
          service_role: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["hr_contractor_status"]
          tax_id: string | null
          updated_at: string
          w9_on_file: boolean
        }
        Insert: {
          address?: string | null
          company_name?: string | null
          contract_number?: string | null
          created_at?: string
          department_id?: string | null
          email: string
          end_date?: string | null
          first_name: string
          id?: string
          last_name: string
          notes?: string | null
          phone?: string | null
          rate?: number | null
          rate_type?:
            | Database["public"]["Enums"]["hr_contractor_rate_type"]
            | null
          service_role?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["hr_contractor_status"]
          tax_id?: string | null
          updated_at?: string
          w9_on_file?: boolean
        }
        Update: {
          address?: string | null
          company_name?: string | null
          contract_number?: string | null
          created_at?: string
          department_id?: string | null
          email?: string
          end_date?: string | null
          first_name?: string
          id?: string
          last_name?: string
          notes?: string | null
          phone?: string | null
          rate?: number | null
          rate_type?:
            | Database["public"]["Enums"]["hr_contractor_rate_type"]
            | null
          service_role?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["hr_contractor_status"]
          tax_id?: string | null
          updated_at?: string
          w9_on_file?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "hr_contractors_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "hr_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_departments: {
        Row: {
          created_at: string
          description: string | null
          head_employee_id: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          head_employee_id?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          head_employee_id?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_departments_head_fk"
            columns: ["head_employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_documents: {
        Row: {
          created_at: string
          description: string | null
          employee_id: string
          file_size: number | null
          file_type: string | null
          file_url: string
          id: string
          name: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          employee_id: string
          file_size?: number | null
          file_type?: string | null
          file_url: string
          id?: string
          name: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          employee_id?: string
          file_size?: number | null
          file_type?: string | null
          file_url?: string
          id?: string
          name?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hr_documents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_employees: {
        Row: {
          address: string | null
          avatar_url: string | null
          created_at: string
          date_of_birth: string | null
          department_id: string | null
          email: string
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          employment_status: Database["public"]["Enums"]["hr_employment_status"]
          first_name: string
          hire_date: string | null
          id: string
          job_title: string | null
          last_name: string
          manager_id: string | null
          notes: string | null
          phone: string | null
          salary: number | null
          ssn: string | null
          termination_date: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          address?: string | null
          avatar_url?: string | null
          created_at?: string
          date_of_birth?: string | null
          department_id?: string | null
          email: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employment_status?: Database["public"]["Enums"]["hr_employment_status"]
          first_name: string
          hire_date?: string | null
          id?: string
          job_title?: string | null
          last_name: string
          manager_id?: string | null
          notes?: string | null
          phone?: string | null
          salary?: number | null
          ssn?: string | null
          termination_date?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          address?: string | null
          avatar_url?: string | null
          created_at?: string
          date_of_birth?: string | null
          department_id?: string | null
          email?: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employment_status?: Database["public"]["Enums"]["hr_employment_status"]
          first_name?: string
          hire_date?: string | null
          id?: string
          job_title?: string | null
          last_name?: string
          manager_id?: string | null
          notes?: string | null
          phone?: string | null
          salary?: number | null
          ssn?: string | null
          termination_date?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hr_employees_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "hr_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_employees_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_grievances: {
        Row: {
          assigned_to: string | null
          category: string
          created_at: string
          description: string | null
          id: string
          is_anonymous: boolean
          priority: Database["public"]["Enums"]["hr_grievance_priority"]
          resolution_notes: string | null
          status: Database["public"]["Enums"]["hr_grievance_status"]
          submitted_by: string | null
          summary: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          category: string
          created_at?: string
          description?: string | null
          id?: string
          is_anonymous?: boolean
          priority?: Database["public"]["Enums"]["hr_grievance_priority"]
          resolution_notes?: string | null
          status?: Database["public"]["Enums"]["hr_grievance_status"]
          submitted_by?: string | null
          summary: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          is_anonymous?: boolean
          priority?: Database["public"]["Enums"]["hr_grievance_priority"]
          resolution_notes?: string | null
          status?: Database["public"]["Enums"]["hr_grievance_status"]
          submitted_by?: string | null
          summary?: string
          updated_at?: string
        }
        Relationships: []
      }
      hr_notifications: {
        Row: {
          created_at: string
          id: string
          link: string | null
          message: string
          read: boolean
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          link?: string | null
          message: string
          read?: boolean
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          link?: string | null
          message?: string
          read?: boolean
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      hr_onboarding_checklists: {
        Row: {
          created_at: string
          employee_id: string
          id: string
          stage: Database["public"]["Enums"]["hr_onboarding_stage"]
          start_date: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          id?: string
          stage?: Database["public"]["Enums"]["hr_onboarding_stage"]
          start_date: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          id?: string
          stage?: Database["public"]["Enums"]["hr_onboarding_stage"]
          start_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_onboarding_checklists_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_onboarding_tasks: {
        Row: {
          checklist_id: string
          completed_at: string | null
          created_at: string
          id: string
          is_completed: boolean
          name: string
          sort_order: number
        }
        Insert: {
          checklist_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          is_completed?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          checklist_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          is_completed?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "hr_onboarding_tasks_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "hr_onboarding_checklists"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_one_on_ones: {
        Row: {
          action_items: string | null
          created_at: string
          created_by: string | null
          employee_id: string
          id: string
          is_private: boolean
          manager_id: string
          meeting_date: string
          summary: string | null
          updated_at: string
        }
        Insert: {
          action_items?: string | null
          created_at?: string
          created_by?: string | null
          employee_id: string
          id?: string
          is_private?: boolean
          manager_id: string
          meeting_date: string
          summary?: string | null
          updated_at?: string
        }
        Update: {
          action_items?: string | null
          created_at?: string
          created_by?: string | null
          employee_id?: string
          id?: string
          is_private?: boolean
          manager_id?: string
          meeting_date?: string
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_one_on_ones_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_one_on_ones_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_payroll_records: {
        Row: {
          created_at: string
          deductions: number
          employee_id: string
          gross_pay: number
          id: string
          net_pay: number
          notes: string | null
          period_end: string
          period_start: string
          status: Database["public"]["Enums"]["hr_payroll_status"]
          taxes: number
        }
        Insert: {
          created_at?: string
          deductions?: number
          employee_id: string
          gross_pay: number
          id?: string
          net_pay: number
          notes?: string | null
          period_end: string
          period_start: string
          status?: Database["public"]["Enums"]["hr_payroll_status"]
          taxes?: number
        }
        Update: {
          created_at?: string
          deductions?: number
          employee_id?: string
          gross_pay?: number
          id?: string
          net_pay?: number
          notes?: string | null
          period_end?: string
          period_start?: string
          status?: Database["public"]["Enums"]["hr_payroll_status"]
          taxes?: number
        }
        Relationships: [
          {
            foreignKeyName: "hr_payroll_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_performance_reviews: {
        Row: {
          acknowledged_at: string | null
          areas_to_improve: string | null
          completed_at: string | null
          created_at: string
          cycle_id: string
          employee_comments: string | null
          employee_id: string
          id: string
          manager_comments: string | null
          overall_rating: number | null
          reviewer_id: string | null
          status: Database["public"]["Enums"]["hr_review_status"]
          strengths: string | null
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          areas_to_improve?: string | null
          completed_at?: string | null
          created_at?: string
          cycle_id: string
          employee_comments?: string | null
          employee_id: string
          id?: string
          manager_comments?: string | null
          overall_rating?: number | null
          reviewer_id?: string | null
          status?: Database["public"]["Enums"]["hr_review_status"]
          strengths?: string | null
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          areas_to_improve?: string | null
          completed_at?: string | null
          created_at?: string
          cycle_id?: string
          employee_comments?: string | null
          employee_id?: string
          id?: string
          manager_comments?: string | null
          overall_rating?: number | null
          reviewer_id?: string | null
          status?: Database["public"]["Enums"]["hr_review_status"]
          strengths?: string | null
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_performance_reviews_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "hr_review_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_performance_reviews_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_performance_reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_pto_balances: {
        Row: {
          accrual_rate_per_year: number
          accrued_days: number
          carryover_days: number
          created_at: string
          employee_id: string
          id: string
          notes: string | null
          type: Database["public"]["Enums"]["hr_time_off_type"]
          updated_at: string
          used_days: number
          year: number
        }
        Insert: {
          accrual_rate_per_year?: number
          accrued_days?: number
          carryover_days?: number
          created_at?: string
          employee_id: string
          id?: string
          notes?: string | null
          type: Database["public"]["Enums"]["hr_time_off_type"]
          updated_at?: string
          used_days?: number
          year?: number
        }
        Update: {
          accrual_rate_per_year?: number
          accrued_days?: number
          carryover_days?: number
          created_at?: string
          employee_id?: string
          id?: string
          notes?: string | null
          type?: Database["public"]["Enums"]["hr_time_off_type"]
          updated_at?: string
          used_days?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "hr_pto_balances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_review_cycles: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          name: string
          period_end: string
          period_start: string
          status: Database["public"]["Enums"]["hr_review_cycle_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          name: string
          period_end: string
          period_start: string
          status?: Database["public"]["Enums"]["hr_review_cycle_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          name?: string
          period_end?: string
          period_start?: string
          status?: Database["public"]["Enums"]["hr_review_cycle_status"]
          updated_at?: string
        }
        Relationships: []
      }
      hr_review_goals: {
        Row: {
          created_at: string
          description: string | null
          id: string
          progress_pct: number
          review_id: string
          sort_order: number
          status: Database["public"]["Enums"]["hr_goal_status"]
          target_date: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          progress_pct?: number
          review_id: string
          sort_order?: number
          status?: Database["public"]["Enums"]["hr_goal_status"]
          target_date?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          progress_pct?: number
          review_id?: string
          sort_order?: number
          status?: Database["public"]["Enums"]["hr_goal_status"]
          target_date?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_review_goals_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "hr_performance_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_settings: {
        Row: {
          google_calendar_id: string | null
          id: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          google_calendar_id?: string | null
          id?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          google_calendar_id?: string | null
          id?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      hr_time_off_requests: {
        Row: {
          calendar_event_id: string | null
          created_at: string
          days: number
          employee_id: string
          end_date: string
          id: string
          reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          start_date: string
          status: Database["public"]["Enums"]["hr_request_status"]
          type: Database["public"]["Enums"]["hr_time_off_type"]
          updated_at: string
        }
        Insert: {
          calendar_event_id?: string | null
          created_at?: string
          days: number
          employee_id: string
          end_date: string
          id?: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["hr_request_status"]
          type: Database["public"]["Enums"]["hr_time_off_type"]
          updated_at?: string
        }
        Update: {
          calendar_event_id?: string | null
          created_at?: string
          days?: number
          employee_id?: string
          end_date?: string
          id?: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["hr_request_status"]
          type?: Database["public"]["Enums"]["hr_time_off_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_time_off_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      icd10_codes: {
        Row: {
          code: string
          created_at: string
          long_description: string | null
          short_description: string
        }
        Insert: {
          code: string
          created_at?: string
          long_description?: string | null
          short_description: string
        }
        Update: {
          code?: string
          created_at?: string
          long_description?: string | null
          short_description?: string
        }
        Relationships: []
      }
      import_jobs: {
        Row: {
          byte_offset: number
          created_at: string
          created_by: string | null
          error_message: string | null
          file_path: string | null
          hospital_address: string | null
          hospital_city: string | null
          hospital_name: string | null
          hospital_state: string | null
          hospital_zip: string | null
          id: string
          kind: string
          network: string | null
          provider_id: string | null
          rows_imported: number
          status: string
          total_bytes: number | null
          total_rows: number | null
          updated_at: string
          url: string | null
        }
        Insert: {
          byte_offset?: number
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          file_path?: string | null
          hospital_address?: string | null
          hospital_city?: string | null
          hospital_name?: string | null
          hospital_state?: string | null
          hospital_zip?: string | null
          id?: string
          kind?: string
          network?: string | null
          provider_id?: string | null
          rows_imported?: number
          status?: string
          total_bytes?: number | null
          total_rows?: number | null
          updated_at?: string
          url?: string | null
        }
        Update: {
          byte_offset?: number
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          file_path?: string | null
          hospital_address?: string | null
          hospital_city?: string | null
          hospital_name?: string | null
          hospital_state?: string | null
          hospital_zip?: string | null
          id?: string
          kind?: string
          network?: string | null
          provider_id?: string | null
          rows_imported?: number
          status?: string
          total_bytes?: number | null
          total_rows?: number | null
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_jobs_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_health_checks: {
        Row: {
          checked_at: string
          created_at: string
          elapsed_ms: number | null
          error_message: string | null
          http_status: number | null
          id: string
          integration: string
          ok: boolean
          resource: string | null
          scope: string | null
        }
        Insert: {
          checked_at?: string
          created_at?: string
          elapsed_ms?: number | null
          error_message?: string | null
          http_status?: number | null
          id?: string
          integration: string
          ok: boolean
          resource?: string | null
          scope?: string | null
        }
        Update: {
          checked_at?: string
          created_at?: string
          elapsed_ms?: number | null
          error_message?: string | null
          http_status?: number | null
          id?: string
          integration?: string
          ok?: boolean
          resource?: string | null
          scope?: string | null
        }
        Relationships: []
      }
      invitations: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          first_name: string
          id: string
          last_name: string
          role: Database["public"]["Enums"]["app_role"]
          status: string
          token: string
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          first_name: string
          id?: string
          last_name: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: []
      }
      medications: {
        Row: {
          category: string
          cost_per_unit: number
          created_at: string
          date_inventoried: string
          dispense_price_per_unit: number
          dosage_form: string
          expiry_date: string | null
          generic_name: string
          id: string
          lot_number: string | null
          manufacturer: string | null
          name: string
          ndc_number: string
          quantity: number
          reorder_level: number
          strength: string
          supplier: string | null
          unit_type: string
          updated_at: string
        }
        Insert: {
          category?: string
          cost_per_unit?: number
          created_at?: string
          date_inventoried?: string
          dispense_price_per_unit?: number
          dosage_form?: string
          expiry_date?: string | null
          generic_name?: string
          id?: string
          lot_number?: string | null
          manufacturer?: string | null
          name: string
          ndc_number?: string
          quantity?: number
          reorder_level?: number
          strength?: string
          supplier?: string | null
          unit_type?: string
          updated_at?: string
        }
        Update: {
          category?: string
          cost_per_unit?: number
          created_at?: string
          date_inventoried?: string
          dispense_price_per_unit?: number
          dosage_form?: string
          expiry_date?: string | null
          generic_name?: string
          id?: string
          lot_number?: string | null
          manufacturer?: string | null
          name?: string
          ndc_number?: string
          quantity?: number
          reorder_level?: number
          strength?: string
          supplier?: string | null
          unit_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      phi_access_log: {
        Row: {
          created_at: string
          http_status: number | null
          id: string
          ip: string | null
          resource: string | null
          resource_id: string | null
          row_count: number | null
          scope: string | null
          source: string
          user_agent: string | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          http_status?: number | null
          id?: string
          ip?: string | null
          resource?: string | null
          resource_id?: string | null
          row_count?: number | null
          scope?: string | null
          source: string
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          http_status?: number | null
          id?: string
          ip?: string | null
          resource?: string | null
          resource_id?: string | null
          row_count?: number | null
          scope?: string | null
          source?: string
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      portal_admin_actions: {
        Row: {
          action: string
          actor_email: string | null
          actor_user_id: string | null
          after_state: Json | null
          before_state: Json | null
          created_at: string
          elation_patient_id: string | null
          error_message: string | null
          http_status: number | null
          id: string
          ok: boolean
          reason: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_user_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          elation_patient_id?: string | null
          error_message?: string | null
          http_status?: number | null
          id?: string
          ok?: boolean
          reason?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_user_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          elation_patient_id?: string | null
          error_message?: string | null
          http_status?: number | null
          id?: string
          ok?: boolean
          reason?: string | null
        }
        Relationships: []
      }
      prescription_queue: {
        Row: {
          created_at: string
          date_written: string | null
          days_supply: number | null
          dea_schedule: string | null
          diagnosis_code: string | null
          directions: string | null
          elation_prescription_id: string | null
          id: string
          lot_number: string | null
          medication_manufacturer: string | null
          medication_name: string | null
          medication_ndc: string | null
          medication_strength: string | null
          note_to_pharmacy: string | null
          patient_address: string | null
          patient_dob: string | null
          patient_name: string | null
          patient_phone: string | null
          prescriber_dea: string | null
          prescriber_name: string | null
          prescriber_npi: string | null
          prescriber_phone: string | null
          quantity: number | null
          raw_payload: Json | null
          refills_authorized: number | null
          status: string
          status_reason: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          date_written?: string | null
          days_supply?: number | null
          dea_schedule?: string | null
          diagnosis_code?: string | null
          directions?: string | null
          elation_prescription_id?: string | null
          id?: string
          lot_number?: string | null
          medication_manufacturer?: string | null
          medication_name?: string | null
          medication_ndc?: string | null
          medication_strength?: string | null
          note_to_pharmacy?: string | null
          patient_address?: string | null
          patient_dob?: string | null
          patient_name?: string | null
          patient_phone?: string | null
          prescriber_dea?: string | null
          prescriber_name?: string | null
          prescriber_npi?: string | null
          prescriber_phone?: string | null
          quantity?: number | null
          raw_payload?: Json | null
          refills_authorized?: number | null
          status?: string
          status_reason?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          date_written?: string | null
          days_supply?: number | null
          dea_schedule?: string | null
          diagnosis_code?: string | null
          directions?: string | null
          elation_prescription_id?: string | null
          id?: string
          lot_number?: string | null
          medication_manufacturer?: string | null
          medication_name?: string | null
          medication_ndc?: string | null
          medication_strength?: string | null
          note_to_pharmacy?: string | null
          patient_address?: string | null
          patient_dob?: string | null
          patient_name?: string | null
          patient_phone?: string | null
          prescriber_dea?: string | null
          prescriber_name?: string | null
          prescriber_npi?: string | null
          prescriber_phone?: string | null
          quantity?: number | null
          raw_payload?: Json | null
          refills_authorized?: number | null
          status?: string
          status_reason?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      price_audit_log: {
        Row: {
          changed_at: string
          changed_by: string | null
          changed_by_name: string | null
          component: string
          id: string
          new_price: number
          old_price: number
          provider_id: string
          service_id: string
          service_price_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string | null
          component: string
          id?: string
          new_price: number
          old_price: number
          provider_id: string
          service_id: string
          service_price_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string | null
          component?: string
          id?: string
          new_price?: number
          old_price?: number
          provider_id?: string
          service_id?: string
          service_price_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          phi_acknowledged_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          phi_acknowledged_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          phi_acknowledged_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      providers: {
        Row: {
          address: string | null
          categories: string[]
          city: string | null
          created_at: string
          distance: number | null
          fax: string | null
          id: string
          last_price_update: string | null
          name: string
          network: string | null
          phone: string | null
          specialty_id: string | null
          state: string | null
          updated_at: string
          zip: string | null
        }
        Insert: {
          address?: string | null
          categories?: string[]
          city?: string | null
          created_at?: string
          distance?: number | null
          fax?: string | null
          id?: string
          last_price_update?: string | null
          name: string
          network?: string | null
          phone?: string | null
          specialty_id?: string | null
          state?: string | null
          updated_at?: string
          zip?: string | null
        }
        Update: {
          address?: string | null
          categories?: string[]
          city?: string | null
          created_at?: string
          distance?: number | null
          fax?: string | null
          id?: string
          last_price_update?: string | null
          name?: string
          network?: string | null
          phone?: string | null
          specialty_id?: string | null
          state?: string | null
          updated_at?: string
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "providers_specialty_id_fkey"
            columns: ["specialty_id"]
            isOneToOne: false
            referencedRelation: "specialties"
            referencedColumns: ["id"]
          },
        ]
      }
      role_change_audit: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          id: string
          new_role: Database["public"]["Enums"]["app_role"] | null
          previous_role: Database["public"]["Enums"]["app_role"] | null
          privileged: boolean
          target_user_id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          new_role?: Database["public"]["Enums"]["app_role"] | null
          previous_role?: Database["public"]["Enums"]["app_role"] | null
          privileged?: boolean
          target_user_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          new_role?: Database["public"]["Enums"]["app_role"] | null
          previous_role?: Database["public"]["Enums"]["app_role"] | null
          privileged?: boolean
          target_user_id?: string
        }
        Relationships: []
      }
      service_prices: {
        Row: {
          component: string
          created_at: string
          id: string
          price: number
          provider_id: string
          service_id: string
          updated_at: string
        }
        Insert: {
          component: string
          created_at?: string
          id?: string
          price: number
          provider_id: string
          service_id: string
          updated_at?: string
        }
        Update: {
          component?: string
          created_at?: string
          id?: string
          price?: number
          provider_id?: string
          service_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_prices_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_prices_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          cpt_code: string | null
          created_at: string
          description: string | null
          icd10_codes: string[]
          id: string
          name: string
          nhsn_category: string | null
          specialty_id: string
          updated_at: string
        }
        Insert: {
          cpt_code?: string | null
          created_at?: string
          description?: string | null
          icd10_codes?: string[]
          id: string
          name: string
          nhsn_category?: string | null
          specialty_id: string
          updated_at?: string
        }
        Update: {
          cpt_code?: string | null
          created_at?: string
          description?: string | null
          icd10_codes?: string[]
          id?: string
          name?: string
          nhsn_category?: string | null
          specialty_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_specialty_id_fkey"
            columns: ["specialty_id"]
            isOneToOne: false
            referencedRelation: "specialties"
            referencedColumns: ["id"]
          },
        ]
      }
      specialties: {
        Row: {
          created_at: string
          icon: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          icon?: string
          id: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          icon?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          granted_at: string
          granted_by: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_employee_id: { Args: never; Returns: string }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_employee_manager_of: {
        Args: { _employee_id: string; _viewer_user_id: string }
        Returns: boolean
      }
      is_hr_admin: { Args: { _user_id: string }; Returns: boolean }
      is_hr_manager: { Args: { _user_id: string }; Returns: boolean }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
    }
    Enums: {
      app_role:
        | "super_admin"
        | "admin"
        | "pharmacy"
        | "clinical"
        | "hr"
        | "billing"
        | "staff"
        | "pending"
      hr_attendance_status:
        | "present"
        | "absent"
        | "late"
        | "remote"
        | "holiday"
        | "sick"
      hr_contractor_rate_type: "hourly" | "daily" | "per_project" | "retainer"
      hr_contractor_status: "active" | "inactive" | "terminated"
      hr_employment_status: "active" | "on_leave" | "terminated" | "suspended"
      hr_goal_status: "not_started" | "in_progress" | "completed" | "cancelled"
      hr_grievance_priority: "low" | "medium" | "high" | "urgent"
      hr_grievance_status:
        | "new"
        | "under_review"
        | "in_progress"
        | "resolved"
        | "closed"
      hr_onboarding_stage:
        | "pre_hire"
        | "first_day"
        | "first_week"
        | "first_month"
        | "complete"
      hr_payroll_status: "pending" | "processed" | "paid" | "cancelled"
      hr_request_status: "pending" | "approved" | "denied" | "cancelled"
      hr_review_cycle_status: "draft" | "active" | "closed"
      hr_review_status:
        | "draft"
        | "in_progress"
        | "employee_review"
        | "completed"
      hr_time_off_type:
        | "vacation"
        | "sick"
        | "personal"
        | "bereavement"
        | "jury_duty"
        | "unpaid"
        | "other"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "super_admin",
        "admin",
        "pharmacy",
        "clinical",
        "hr",
        "billing",
        "staff",
        "pending",
      ],
      hr_attendance_status: [
        "present",
        "absent",
        "late",
        "remote",
        "holiday",
        "sick",
      ],
      hr_contractor_rate_type: ["hourly", "daily", "per_project", "retainer"],
      hr_contractor_status: ["active", "inactive", "terminated"],
      hr_employment_status: ["active", "on_leave", "terminated", "suspended"],
      hr_goal_status: ["not_started", "in_progress", "completed", "cancelled"],
      hr_grievance_priority: ["low", "medium", "high", "urgent"],
      hr_grievance_status: [
        "new",
        "under_review",
        "in_progress",
        "resolved",
        "closed",
      ],
      hr_onboarding_stage: [
        "pre_hire",
        "first_day",
        "first_week",
        "first_month",
        "complete",
      ],
      hr_payroll_status: ["pending", "processed", "paid", "cancelled"],
      hr_request_status: ["pending", "approved", "denied", "cancelled"],
      hr_review_cycle_status: ["draft", "active", "closed"],
      hr_review_status: [
        "draft",
        "in_progress",
        "employee_review",
        "completed",
      ],
      hr_time_off_type: [
        "vacation",
        "sick",
        "personal",
        "bereavement",
        "jury_duty",
        "unpaid",
        "other",
      ],
    },
  },
} as const
