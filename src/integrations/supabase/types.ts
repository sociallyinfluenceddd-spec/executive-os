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
          content: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          agent_id: string
          content: string
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          agent_id?: string
          content?: string
          created_at?: string
          id?: string
          role?: string
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
      exec_os_agents: {
        Row: {
          avatar_letter: string
          color: string
          created_at: string
          enabled: boolean
          id: string
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
          id?: string
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
          id?: string
          name?: string
          order_index?: number
          role?: string
          system_prompt?: string
          updated_at?: string
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
    }
    Views: {
      [_ in never]: never
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
