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
      exec_os_agent_messages: {
        Row: {
          agent_id: string
          attachments: Json
          content: string
          cost_usd: number | null
          created_at: string
          id: string
          input_tokens: number | null
          model: string | null
          output_tokens: number | null
          reasoning: string | null
          role: string
          thread_id: string | null
          tool_calls: Json | null
          tool_results: Json | null
          user_id: string
        }
        Insert: {
          agent_id: string
          attachments?: Json
          content: string
          cost_usd?: number | null
          created_at?: string
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          reasoning?: string | null
          role: string
          thread_id?: string | null
          tool_calls?: Json | null
          tool_results?: Json | null
          user_id: string
        }
        Update: {
          agent_id?: string
          attachments?: Json
          content?: string
          cost_usd?: number | null
          created_at?: string
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          reasoning?: string | null
          role?: string
          thread_id?: string | null
          tool_calls?: Json | null
          tool_results?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exec_os_agent_messages_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "exec_os_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      exec_os_agent_threads: {
        Row: {
          agent_id: string
          archived: boolean
          created_at: string
          id: string
          last_message_at: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id: string
          archived?: boolean
          created_at?: string
          id?: string
          last_message_at?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          archived?: boolean
          created_at?: string
          id?: string
          last_message_at?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      exec_os_agents: {
        Row: {
          avatar_letter: string
          color: string
          created_at: string
          enabled: boolean
          focus_data: Json
          id: string
          model_tier: string
          name: string
          order_index: number
          role: string
          system_prompt: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_letter: string
          color: string
          created_at?: string
          enabled?: boolean
          focus_data?: Json
          id?: string
          model_tier?: string
          name: string
          order_index: number
          role: string
          system_prompt: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_letter?: string
          color?: string
          created_at?: string
          enabled?: boolean
          focus_data?: Json
          id?: string
          model_tier?: string
          name?: string
          order_index?: number
          role?: string
          system_prompt?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      exec_os_ai_usage: {
        Row: {
          advisor_id: string | null
          cost_usd: number
          created_at: string
          day: string
          id: string
          input_tokens: number
          model: string
          output_tokens: number
          tier: string
          user_id: string
        }
        Insert: {
          advisor_id?: string | null
          cost_usd?: number
          created_at?: string
          day?: string
          id?: string
          input_tokens?: number
          model: string
          output_tokens?: number
          tier: string
          user_id: string
        }
        Update: {
          advisor_id?: string | null
          cost_usd?: number
          created_at?: string
          day?: string
          id?: string
          input_tokens?: number
          model?: string
          output_tokens?: number
          tier?: string
          user_id?: string
        }
        Relationships: []
      }
      exec_os_calendar_events: {
        Row: {
          account: string
          attendees: Json | null
          calendar_id: string | null
          calendar_name: string | null
          created_at: string
          description: string | null
          end_at: string | null
          external_id: string
          id: string
          is_all_day: boolean | null
          location: string | null
          organizer_email: string | null
          start_at: string | null
          status: string | null
          title: string | null
          updated_at: string
          user_id: string
          video_url: string | null
        }
        Insert: {
          account: string
          attendees?: Json | null
          calendar_id?: string | null
          calendar_name?: string | null
          created_at?: string
          description?: string | null
          end_at?: string | null
          external_id: string
          id?: string
          is_all_day?: boolean | null
          location?: string | null
          organizer_email?: string | null
          start_at?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
          video_url?: string | null
        }
        Update: {
          account?: string
          attendees?: Json | null
          calendar_id?: string | null
          calendar_name?: string | null
          created_at?: string
          description?: string | null
          end_at?: string | null
          external_id?: string
          id?: string
          is_all_day?: boolean | null
          location?: string | null
          organizer_email?: string | null
          start_at?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
          video_url?: string | null
        }
        Relationships: []
      }
      exec_os_captures: {
        Row: {
          captured_at: string
          created_at: string
          extracted: Json | null
          id: string
          raw_text: string
          routed_to: string[] | null
          source: string
          user_id: string
        }
        Insert: {
          captured_at?: string
          created_at?: string
          extracted?: Json | null
          id?: string
          raw_text: string
          routed_to?: string[] | null
          source?: string
          user_id: string
        }
        Update: {
          captured_at?: string
          created_at?: string
          extracted?: Json | null
          id?: string
          raw_text?: string
          routed_to?: string[] | null
          source?: string
          user_id?: string
        }
        Relationships: []
      }
      exec_os_daily: {
        Row: {
          blockers: string | null
          created_at: string
          energy_level: number | null
          entry_date: string
          id: string
          mood: string | null
          must_move_1: string | null
          must_move_2: string | null
          must_move_3: string | null
          tomorrow_seed: string | null
          top_priority: string | null
          updated_at: string
          user_id: string
          what_didnt: string | null
          what_moved: string | null
        }
        Insert: {
          blockers?: string | null
          created_at?: string
          energy_level?: number | null
          entry_date?: string
          id?: string
          mood?: string | null
          must_move_1?: string | null
          must_move_2?: string | null
          must_move_3?: string | null
          tomorrow_seed?: string | null
          top_priority?: string | null
          updated_at?: string
          user_id: string
          what_didnt?: string | null
          what_moved?: string | null
        }
        Update: {
          blockers?: string | null
          created_at?: string
          energy_level?: number | null
          entry_date?: string
          id?: string
          mood?: string | null
          must_move_1?: string | null
          must_move_2?: string | null
          must_move_3?: string | null
          tomorrow_seed?: string | null
          top_priority?: string | null
          updated_at?: string
          user_id?: string
          what_didnt?: string | null
          what_moved?: string | null
        }
        Relationships: []
      }
      exec_os_decisions: {
        Row: {
          category: string | null
          context: string | null
          created_at: string
          decided_at: string
          decision_text: string
          id: string
          user_id: string
        }
        Insert: {
          category?: string | null
          context?: string | null
          created_at?: string
          decided_at?: string
          decision_text: string
          id?: string
          user_id: string
        }
        Update: {
          category?: string | null
          context?: string | null
          created_at?: string
          decided_at?: string
          decision_text?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      exec_os_emails: {
        Row: {
          account: string
          attendees: Json | null
          created_at: string
          external_id: string | null
          id: string
          kind: string
          raw_classification: Json | null
          received_at: string | null
          scheduled_at: string | null
          sender_email: string | null
          sender_name: string | null
          snippet: string | null
          status: string | null
          subject: string | null
          updated_at: string
          user_id: string
          video_url: string | null
        }
        Insert: {
          account: string
          attendees?: Json | null
          created_at?: string
          external_id?: string | null
          id?: string
          kind: string
          raw_classification?: Json | null
          received_at?: string | null
          scheduled_at?: string | null
          sender_email?: string | null
          sender_name?: string | null
          snippet?: string | null
          status?: string | null
          subject?: string | null
          updated_at?: string
          user_id: string
          video_url?: string | null
        }
        Update: {
          account?: string
          attendees?: Json | null
          created_at?: string
          external_id?: string | null
          id?: string
          kind?: string
          raw_classification?: Json | null
          received_at?: string | null
          scheduled_at?: string | null
          sender_email?: string | null
          sender_name?: string | null
          snippet?: string | null
          status?: string | null
          subject?: string | null
          updated_at?: string
          user_id?: string
          video_url?: string | null
        }
        Relationships: []
      }
      exec_os_kitchen_recipes: {
        Row: {
          created_at: string
          id: string
          ingredients: Json
          meal_type: string
          name: string
          prep_notes: string | null
          scheduled_for: string | null
          source: string | null
          steps: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          ingredients?: Json
          meal_type: string
          name: string
          prep_notes?: string | null
          scheduled_for?: string | null
          source?: string | null
          steps?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          ingredients?: Json
          meal_type?: string
          name?: string
          prep_notes?: string | null
          scheduled_for?: string | null
          source?: string | null
          steps?: Json
          user_id?: string
        }
        Relationships: []
      }
      exec_os_kitchen_shopping: {
        Row: {
          category: string
          checked: boolean
          created_at: string
          id: string
          item: string
          qty: string | null
          recipe_id: string | null
          source: string | null
          user_id: string
        }
        Insert: {
          category?: string
          checked?: boolean
          created_at?: string
          id?: string
          item: string
          qty?: string | null
          recipe_id?: string | null
          source?: string | null
          user_id: string
        }
        Update: {
          category?: string
          checked?: boolean
          created_at?: string
          id?: string
          item?: string
          qty?: string | null
          recipe_id?: string | null
          source?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exec_os_kitchen_shopping_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "exec_os_kitchen_recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      exec_os_notes: {
        Row: {
          agent_id: string | null
          body: string
          created_at: string
          id: string
          tags: string[]
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          body: string
          created_at?: string
          id?: string
          tags?: string[]
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string | null
          body?: string
          created_at?: string
          id?: string
          tags?: string[]
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      exec_os_public_profile: {
        Row: {
          created_at: string
          cta_label: string | null
          cta_url: string | null
          display_name: string
          share_clients: boolean
          share_content: boolean
          share_revenue: boolean
          tagline: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          display_name: string
          share_clients?: boolean
          share_content?: boolean
          share_revenue?: boolean
          tagline?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          display_name?: string
          share_clients?: boolean
          share_content?: boolean
          share_revenue?: boolean
          tagline?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      exec_os_revenue: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          entry_date: string
          external_id: string | null
          id: string
          notes: string | null
          source: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          entry_date: string
          external_id?: string | null
          id?: string
          notes?: string | null
          source: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          entry_date?: string
          external_id?: string | null
          id?: string
          notes?: string | null
          source?: string
          user_id?: string
        }
        Relationships: []
      }
      exec_os_suggestions: {
        Row: {
          agent_id: string | null
          created_at: string
          id: string
          kind: string
          payload: Json
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          id?: string
          kind: string
          payload?: Json
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      exec_os_tasks: {
        Row: {
          agent_id: string | null
          created_at: string
          due_at: string | null
          id: string
          source_message_id: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          source_message_id?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          source_message_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      exec_os_weekly_summaries: {
        Row: {
          created_at: string
          id: string
          metrics: Json
          summary: string | null
          user_id: string
          week_start: string
        }
        Insert: {
          created_at?: string
          id?: string
          metrics?: Json
          summary?: string | null
          user_id: string
          week_start: string
        }
        Update: {
          created_at?: string
          id?: string
          metrics?: Json
          summary?: string | null
          user_id?: string
          week_start?: string
        }
        Relationships: []
      }
      feature_interest: {
        Row: {
          created_at: string
          feature: string
          id: string
          user_email: string | null
        }
        Insert: {
          created_at?: string
          feature: string
          id?: string
          user_email?: string | null
        }
        Update: {
          created_at?: string
          feature?: string
          id?: string
          user_email?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      public_revenue_monthly: {
        Row: {
          amount_cents: number | null
          entries: number | null
          month: string | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
