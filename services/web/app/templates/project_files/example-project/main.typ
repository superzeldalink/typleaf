#set page(paper: "us-letter", margin: (x: 1.2in, y: 1in))
#set text(size: 11pt)

= Your Paper
You

== Introduction

Your introduction goes here. Use the Recompile button to preview updates.

== Some examples to get started

=== Figure

#figure(
  image("frog.jpg", width: 30%),
  caption: [This frog was uploaded with the template files.],
)

=== Table

#table(
  columns: 2,
  [Item], [Quantity],
  [Widgets], [42],
  [Gadgets], [13],
)

=== Math

$ sum_(k=1)^n k = (n(n+1)) / 2 $
