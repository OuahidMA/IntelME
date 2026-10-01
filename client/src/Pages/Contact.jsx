import { Link } from "react-router-dom"
import { ArrowRight, Mail } from "lucide-react"

import { Footer } from "@/components/Footer"
import { Navbar } from "@/components/Navbar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollProgress } from "@/components/ui/scroll-progress"

const EMAIL = "hello@intelme.app"

const include = [
  "The job title and posting you are targeting.",
  "The stage you are stuck at: no reply, no interview, or an offer you did not expect.",
  "The file you uploaded, if a specific check looks wrong.",
]

export default function Contact() {
  return (
    <div className="flex min-h-svh flex-col">
      <Navbar />
      <ScrollProgress className="top-18" />

      <main className="flex-1">
        <section className="border-b border-border">
          <div className="hero-wash relative">
            <div className="container-page relative grid justify-items-center gap-6 py-24 text-center sm:py-32">
              <p className="text-sm text-muted-foreground">Contact</p>

              <h1 className="max-w-3xl text-4xl leading-[1.08] font-semibold tracking-[-0.9px] sm:text-5xl sm:tracking-[-1.2px] lg:text-[3.25rem] lg:leading-[1.1] lg:tracking-[-1.5px]">
                Something read wrong? Tell us.
              </h1>

              <p className="max-w-2xl text-lg leading-[1.38] text-muted-foreground">
                A score that does not match your experience is a bug, not feedback.
                Send the details and we will take a look.
              </p>
            </div>
          </div>
        </section>

        <section>
          <div className="container-page grid gap-6 py-20 sm:py-24">
            <Card className="mx-auto w-full max-w-3xl">
              <CardHeader>
                <CardTitle>Email us</CardTitle>
              </CardHeader>

              <CardContent className="grid gap-6">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                    <Mail className="size-4.5" />
                  </span>
                  <a
                    href={`mailto:${EMAIL}`}
                    className="link-hover text-lg text-foreground"
                  >
                    {EMAIL}
                  </a>
                </div>

                <div className="grid gap-3">
                  <p className="text-sm font-medium">Helpful to include</p>
                  <ul className="grid gap-2">
                    {include.map((item) => (
                      <li key={item} className="flex gap-2 text-sm text-muted-foreground">
                        <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-chart-5" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex flex-wrap gap-3 border-t border-border pt-6">
                  <Button
                    size="lg"
                    render={<a href={`mailto:${EMAIL}`} />}
                    className="inset-button h-10 px-4"
                  >
                    Write to us
                    <ArrowRight data-icon="inline-end" />
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    render={<Link to="/" />}
                    className="h-10 px-4"
                  >
                    Back to home
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}
