"use client";

import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { searchGeoPlaces, type GeoPlace, type GeoRef } from "@/lib/api";

type PlaceLike = GeoRef;

export function placeLabel(p: PlaceLike): string {
  return [p.name, p.admin1_name, p.country_code].filter(Boolean).join(", ");
}

function useGeoSearch(open: boolean, countryCode?: string) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoPlace[]>([]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      searchGeoPlaces(query, countryCode).then(setResults);
    }, 200);
    return () => clearTimeout(timer);
  }, [query, open, countryCode]);

  return { query, setQuery, results };
}

// Single-select searchable combobox over the GeoNames reference table.
export function GeoCombobox({
  selected,
  onSelect,
  placeholder = "Select a place…",
  countryCode,
}: {
  selected: PlaceLike | null;
  onSelect: (place: GeoPlace) => void;
  placeholder?: string;
  countryCode?: string;
}) {
  const [open, setOpen] = useState(false);
  const { query, setQuery, results } = useGeoSearch(open, countryCode);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="border border-grey-200 rounded-lg px-3 py-2 text-left text-[13px] flex justify-between items-center gap-2 w-full"
        >
          <span className={selected ? "" : "text-grey-400"}>{selected ? placeLabel(selected) : placeholder}</span>
          <ChevronsUpDown className="h-4 w-4 text-grey-400 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-(--radix-popover-trigger-width)" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search city, region, or country…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>{query ? "No places found." : "Type to search…"}</CommandEmpty>
            <CommandGroup>
              {results.map((r) => (
                <CommandItem
                  key={r.geoname_id}
                  value={String(r.geoname_id)}
                  onSelect={() => {
                    onSelect(r);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <Check className={`mr-2 h-4 w-4 ${selected?.geoname_id === r.geoname_id ? "opacity-100" : "opacity-0"}`} />
                  {placeLabel(r)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Multi-select variant — renders chips for the selected places plus a
// search-to-add trigger. Used for campaign geography targeting.
export function GeoMultiCombobox({
  selected,
  onChange,
  placeholder = "Add a place…",
}: {
  selected: PlaceLike[];
  onChange: (next: PlaceLike[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const { query, setQuery, results } = useGeoSearch(open);

  function add(place: GeoPlace) {
    if (selected.some((s) => s.geoname_id === place.geoname_id)) return;
    onChange([...selected, place]);
  }

  function remove(geonameId: number) {
    onChange(selected.filter((s) => s.geoname_id !== geonameId));
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="border border-grey-200 rounded-lg px-3 py-2 flex flex-wrap gap-1.5 min-h-10 items-center">
        {selected.map((s) => (
          <span
            key={s.geoname_id}
            className="flex items-center gap-0.5 bg-primary/10 text-primary text-[12px] px-2 py-0.5 rounded-full"
          >
            {placeLabel(s)}
            <button type="button" onClick={() => remove(s.geoname_id)} className="leading-none ml-1 hover:text-danger">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button type="button" className="text-[13px] text-grey-400 hover:text-primary px-1">
              {selected.length === 0 ? placeholder : "+ Add"}
            </button>
          </PopoverTrigger>
          <PopoverContent className="p-0 w-64" align="start">
            <Command shouldFilter={false}>
              <CommandInput placeholder="Search city, region, or country…" value={query} onValueChange={setQuery} />
              <CommandList>
                <CommandEmpty>{query ? "No places found." : "Type to search…"}</CommandEmpty>
                <CommandGroup>
                  {results.map((r) => (
                    <CommandItem
                      key={r.geoname_id}
                      value={String(r.geoname_id)}
                      onSelect={() => {
                        add(r);
                        setQuery("");
                      }}
                    >
                      <Check className={`mr-2 h-4 w-4 ${selected.some((s) => s.geoname_id === r.geoname_id) ? "opacity-100" : "opacity-0"}`} />
                      {placeLabel(r)}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
