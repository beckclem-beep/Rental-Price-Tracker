import { NextResponse } from 'next/server'

const API =
  'https://api.parse.bot/scraper/ac2b8d77-183a-4671-a3a2-f58aaf87fd63'

const norm = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

const unwrap = (value: any) => value?.data ?? value?.result ?? value ?? {}

export async function POST(req: Request) {
  const key = process.env.PARSE_API_KEY

  if (!key) {
    return NextResponse.json(
      { error: 'PARSE_API_KEY manquante dans Vercel.' },
      { status: 500 }
    )
  }

  const { pickup, dropoff, age, vehicle } = await req.json()

  if (!pickup || !dropoff) {
    return NextResponse.json(
      { error: 'Dates manquantes.' },
      { status: 400 }
    )
  }

  const headers = {
    'X-API-Key': key,
    Accept: 'application/json',
  }

  // Recherche de l'agence
  const locationUrl = new URL(`${API}/search_locations`)
  locationUrl.searchParams.set('query', 'Brossard')

  const locationResponse = await fetch(locationUrl, {
    headers,
    cache: 'no-store',
  })

  if (!locationResponse.ok) {
    return NextResponse.json(
      {
        error: `Recherche agence: HTTP ${locationResponse.status}`,
      },
      { status: 502 }
    )
  }

  const locationData = unwrap(await locationResponse.json())

  const locations = Array.isArray(locationData.locations)
    ? locationData.locations
    : Array.isArray(locationData.results)
      ? locationData.results
      : []

  // Cherche Brossard / Taschereau / 6185
  const candidates = locations.filter((location: any) => {
    const text = norm(
      [
        location.name,
        location.address,
        location.city,
        location.country,
        location.country_code,
      ].join(' ')
    )

    return (
      text.includes('brossard') ||
      text.includes('taschereau') ||
      text.includes('6185')
    )
  })

  // Priorité à l'agence Taschereau / 6185
  const location =
    candidates.find((x: any) => {
      const text = norm([x.name, x.address].join(' '))
      return text.includes('taschereau') || text.includes('6185')
    }) ||
    candidates.find(
      (x: any) =>
        x.country_code === 'CA' ||
        norm(x.country).includes('canada')
    ) ||
    candidates[0]

  // Si l'agence n'est toujours pas trouvée,
  // on retourne les résultats pour faciliter le diagnostic.
  if (!location?.oag_code) {
    return NextResponse.json(
      {
        error: 'Agence Hertz Brossard introuvable.',
        returned: locations.length,
        locations: locations.slice(0, 10).map((x: any) => ({
          name: x.name,
          address: x.address,
          city: x.city,
          country: x.country,
          country_code: x.country_code,
          oag_code: x.oag_code,
        })),
      },
      { status: 404 }
    )
  }

  // Recherche des véhicules
  const vehicleUrl = new URL(`${API}/search_vehicles`)

  vehicleUrl.searchParams.set(
    'pickup_location',
    location.oag_code
  )

  vehicleUrl.searchParams.set(
    'dropoff_location',
    location.oag_code
  )

  vehicleUrl.searchParams.set(
    'pickup_time',
    new Date(pickup).toISOString()
  )

  vehicleUrl.searchParams.set(
    'dropoff_time',
    new Date(dropoff).toISOString()
  )

  vehicleUrl.searchParams.set(
    'min_age',
    String(age || 25)
  )

  vehicleUrl.searchParams.set(
    'country_code',
    'CA'
  )

  const vehicleResponse = await fetch(vehicleUrl, {
    headers,
    cache: 'no-store',
  })

  if (!vehicleResponse.ok) {
    return NextResponse.json(
      {
        error: `Recherche véhicules: HTTP ${vehicleResponse.status}`,
      },
      { status: 502 }
    )
  }

  const vehicleData = unwrap(await vehicleResponse.json())

  const allVehicles = Array.isArray(vehicleData.vehicles)
    ? vehicleData.vehicles
    : []

  const wanted = norm(vehicle || 'Tesla')

  const vehicles = allVehicles
    .filter((v: any) => {
      const text = norm(
        [
          v.vehicle_display_name,
          v.make_model,
          v.vehicle_type,
          v.vehicle_class,
          v.vehicle_group,
        ].join(' ')
      )

      if (!text.includes('tesla')) {
        return false
      }

      if (wanted.includes('toutes')) {
        return true
      }

      const model = wanted
        .replace('tesla ', '')
        .trim()

      return !model || text.includes(model)
    })
    .map((v: any) => {
      const pricing = v.pricing || {}

      const daily = Number(
        pricing.daily_rate ??
          v.daily_rate ??
          NaN
      )

      const total = Number(
        pricing.approximate_total ??
          pricing.total ??
          pricing.total_price ??
          v.total_price ??
          NaN
      )

      return {
        name:
          v.vehicle_display_name ||
          v.make_model ||
          v.vehicle_type ||
          'Tesla',

        class:
          v.vehicle_class ||
          v.vehicle_group,

        daily: Number.isFinite(daily)
          ? daily
          : undefined,

        total: Number.isFinite(total)
          ? total
          : undefined,

        currency:
          pricing.currency ||
          'CAD',
      }
    })

  return NextResponse.json({
    location: {
      name: location.name,
      address: location.address,
      city: location.city,
      oag_code: location.oag_code,
    },

    vehicles,
  })
}
