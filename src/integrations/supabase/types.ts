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
      boards: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          keywords: string[]
          name: string
          pin_count: number
          pinterest_board_id: string | null
          site_ids: string[]
          synced_at: string | null
          topics: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          keywords?: string[]
          name: string
          pin_count?: number
          pinterest_board_id?: string | null
          site_ids?: string[]
          synced_at?: string | null
          topics?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          keywords?: string[]
          name?: string
          pin_count?: number
          pinterest_board_id?: string | null
          site_ids?: string[]
          synced_at?: string | null
          topics?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      integrations: {
        Row: {
          config_ciphertext: string
          created_at: string
          id: string
          last_error: string | null
          last_used_at: string | null
          provider: Database["public"]["Enums"]["integration_provider"]
          status: Database["public"]["Enums"]["integration_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          config_ciphertext: string
          created_at?: string
          id?: string
          last_error?: string | null
          last_used_at?: string | null
          provider: Database["public"]["Enums"]["integration_provider"]
          status?: Database["public"]["Enums"]["integration_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          config_ciphertext?: string
          created_at?: string
          id?: string
          last_error?: string | null
          last_used_at?: string | null
          provider?: Database["public"]["Enums"]["integration_provider"]
          status?: Database["public"]["Enums"]["integration_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      jobs: {
        Row: {
          attempts: number
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["job_kind"]
          last_error: string | null
          payload: Json
          run_at: string
          status: Database["public"]["Enums"]["job_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["job_kind"]
          last_error?: string | null
          payload?: Json
          run_at?: string
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["job_kind"]
          last_error?: string | null
          payload?: Json
          run_at?: string
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      keywords: {
        Row: {
          created_at: string
          id: string
          keyword: string
          kind: string
          page_id: string | null
          tracked: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          keyword: string
          kind?: string
          page_id?: string | null
          tracked?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          keyword?: string
          kind?: string
          page_id?: string | null
          tracked?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "keywords_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      pages: {
        Row: {
          analysis: Json | null
          content_hash: string | null
          created_at: string
          excluded: boolean
          h1: string | null
          headings: Json | null
          id: string
          images: Json | null
          jsonld: Json | null
          last_analyzed_at: string | null
          last_crawled_at: string | null
          meta_description: string | null
          site_id: string
          status: Database["public"]["Enums"]["page_status"]
          title: string | null
          updated_at: string
          url: string
          user_id: string
        }
        Insert: {
          analysis?: Json | null
          content_hash?: string | null
          created_at?: string
          excluded?: boolean
          h1?: string | null
          headings?: Json | null
          id?: string
          images?: Json | null
          jsonld?: Json | null
          last_analyzed_at?: string | null
          last_crawled_at?: string | null
          meta_description?: string | null
          site_id: string
          status?: Database["public"]["Enums"]["page_status"]
          title?: string | null
          updated_at?: string
          url: string
          user_id: string
        }
        Update: {
          analysis?: Json | null
          content_hash?: string | null
          created_at?: string
          excluded?: boolean
          h1?: string | null
          headings?: Json | null
          id?: string
          images?: Json | null
          jsonld?: Json | null
          last_analyzed_at?: string | null
          last_crawled_at?: string | null
          meta_description?: string | null
          site_id?: string
          status?: Database["public"]["Enums"]["page_status"]
          title?: string | null
          updated_at?: string
          url?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pages_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      pin_briefs: {
        Row: {
          alt_text: string | null
          board_id: string | null
          created_at: string
          cta: string | null
          description: string
          hashtags: string[]
          id: string
          image_prompt: string
          intent: string
          page_id: string
          status: Database["public"]["Enums"]["brief_status"]
          style: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          alt_text?: string | null
          board_id?: string | null
          created_at?: string
          cta?: string | null
          description: string
          hashtags?: string[]
          id?: string
          image_prompt: string
          intent?: string
          page_id: string
          status?: Database["public"]["Enums"]["brief_status"]
          style: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          alt_text?: string | null
          board_id?: string | null
          created_at?: string
          cta?: string | null
          description?: string
          hashtags?: string[]
          id?: string
          image_prompt?: string
          intent?: string
          page_id?: string
          status?: Database["public"]["Enums"]["brief_status"]
          style?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pin_briefs_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pin_briefs_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      pin_images: {
        Row: {
          brief_id: string
          created_at: string
          height: number
          id: string
          meta: Json | null
          prompt_hash: string
          replicate_prediction_id: string | null
          storage_path: string
          user_id: string
          width: number
        }
        Insert: {
          brief_id: string
          created_at?: string
          height?: number
          id?: string
          meta?: Json | null
          prompt_hash: string
          replicate_prediction_id?: string | null
          storage_path: string
          user_id: string
          width?: number
        }
        Update: {
          brief_id?: string
          created_at?: string
          height?: number
          id?: string
          meta?: Json | null
          prompt_hash?: string
          replicate_prediction_id?: string | null
          storage_path?: string
          user_id?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "pin_images_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "pin_briefs"
            referencedColumns: ["id"]
          },
        ]
      }
      publish_logs: {
        Row: {
          at: string
          id: string
          level: string
          message: string
          payload: Json | null
          scheduled_pin_id: string | null
          user_id: string
        }
        Insert: {
          at?: string
          id?: string
          level?: string
          message: string
          payload?: Json | null
          scheduled_pin_id?: string | null
          user_id: string
        }
        Update: {
          at?: string
          id?: string
          level?: string
          message?: string
          payload?: Json | null
          scheduled_pin_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "publish_logs_scheduled_pin_id_fkey"
            columns: ["scheduled_pin_id"]
            isOneToOne: false
            referencedRelation: "scheduled_pins"
            referencedColumns: ["id"]
          },
        ]
      }
      rank_history: {
        Row: {
          captured_at: string
          id: string
          keyword: string
          our_pin_id: string | null
          position: number | null
          user_id: string
        }
        Insert: {
          captured_at?: string
          id?: string
          keyword: string
          our_pin_id?: string | null
          position?: number | null
          user_id: string
        }
        Update: {
          captured_at?: string
          id?: string
          keyword?: string
          our_pin_id?: string | null
          position?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rank_history_our_pin_id_fkey"
            columns: ["our_pin_id"]
            isOneToOne: false
            referencedRelation: "scheduled_pins"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_pins: {
        Row: {
          attempts: number
          board_id: string | null
          brief_id: string
          created_at: string
          id: string
          image_id: string | null
          last_error: string | null
          pinterest_pin_id: string | null
          published_at: string | null
          scheduled_at: string
          status: Database["public"]["Enums"]["pin_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          board_id?: string | null
          brief_id: string
          created_at?: string
          id?: string
          image_id?: string | null
          last_error?: string | null
          pinterest_pin_id?: string | null
          published_at?: string | null
          scheduled_at: string
          status?: Database["public"]["Enums"]["pin_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          board_id?: string | null
          brief_id?: string
          created_at?: string
          id?: string
          image_id?: string | null
          last_error?: string | null
          pinterest_pin_id?: string | null
          published_at?: string | null
          scheduled_at?: string
          status?: Database["public"]["Enums"]["pin_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_pins_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_pins_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "pin_briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_pins_image_id_fkey"
            columns: ["image_id"]
            isOneToOne: false
            referencedRelation: "pin_images"
            referencedColumns: ["id"]
          },
        ]
      }
      serp_snapshots: {
        Row: {
          captured_at: string
          id: string
          keyword: string
          patterns: Json | null
          top_pins: Json
          user_id: string
        }
        Insert: {
          captured_at?: string
          id?: string
          keyword: string
          patterns?: Json | null
          top_pins?: Json
          user_id: string
        }
        Update: {
          captured_at?: string
          id?: string
          keyword?: string
          patterns?: Json | null
          top_pins?: Json
          user_id?: string
        }
        Relationships: []
      }
      sites: {
        Row: {
          accent_color: string | null
          brand_colors: Json
          brand_font: string | null
          brand_name: string | null
          brand_notes: string | null
          created_at: string
          id: string
          settings: Json
          sitemap_url: string | null
          timezone: string
          updated_at: string
          url: string
          user_id: string
        }
        Insert: {
          accent_color?: string | null
          brand_colors?: Json
          brand_font?: string | null
          brand_name?: string | null
          brand_notes?: string | null
          created_at?: string
          id?: string
          settings?: Json
          sitemap_url?: string | null
          timezone?: string
          updated_at?: string
          url: string
          user_id: string
        }
        Update: {
          accent_color?: string | null
          brand_colors?: Json
          brand_font?: string | null
          brand_name?: string | null
          brand_notes?: string | null
          created_at?: string
          id?: string
          settings?: Json
          sitemap_url?: string | null
          timezone?: string
          updated_at?: string
          url?: string
          user_id?: string
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
      brief_status:
        | "draft"
        | "image_pending"
        | "ready"
        | "scheduled"
        | "archived"
      integration_provider: "openai" | "replicate" | "apify" | "pinterest"
      integration_status: "unconfigured" | "ok" | "error"
      job_kind:
        | "crawl"
        | "analyze"
        | "generate_briefs"
        | "generate_image"
        | "publish"
        | "serp_sweep"
        | "autoschedule"
      job_status: "queued" | "running" | "done" | "failed"
      page_status: "active" | "inactive" | "error"
      pin_status:
        | "draft"
        | "queued"
        | "publishing"
        | "published"
        | "failed"
        | "exported"
        | "canceled"
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
      brief_status: [
        "draft",
        "image_pending",
        "ready",
        "scheduled",
        "archived",
      ],
      integration_provider: ["openai", "replicate", "apify", "pinterest"],
      integration_status: ["unconfigured", "ok", "error"],
      job_kind: [
        "crawl",
        "analyze",
        "generate_briefs",
        "generate_image",
        "publish",
        "serp_sweep",
        "autoschedule",
      ],
      job_status: ["queued", "running", "done", "failed"],
      page_status: ["active", "inactive", "error"],
      pin_status: [
        "draft",
        "queued",
        "publishing",
        "published",
        "failed",
        "exported",
        "canceled",
      ],
    },
  },
} as const
