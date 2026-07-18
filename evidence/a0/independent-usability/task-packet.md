# Independent Fadeno workflow task packet

This packet is for an independent participant using only the supplied packed
artifact and public repository documentation. Do not use private implementation
notes or maintainer coaching. Record every started task, including refusal or
abandonment, and classify any assistance.

The facilitator supplies one source commit and its exact package tarball SHA-256.
Use a new empty working directory. Do not include names, contact details,
secrets, absolute paths, unrelated command history, or environment values in
the retained observation.

Perform these tasks in order:

1. Install the supplied package artifact and create a new application with the
   documented `fadeno create` command.
2. Run the stock application tests, introduce the packet's assertion failure,
   use the public diagnostic, repair it, and confirm the old failure clears.
3. Run a successful framework check with explanation and describe the route and
   artifact ownership shown by the public output.
4. Introduce the packet's route-role collision, identify the cause and
   correction, repair it, and confirm stale diagnostics and artifacts clear.
5. Introduce the packet's invalid configuration, identify the refusal, repair
   it, and confirm the corrected configuration is current.
6. Introduce the packet's compiler-generation failure, verify the last accepted
   build is preserved, repair it, and confirm deleted output disappears.
7. Start the documented development command, load the home page, and stop it
   normally.
8. Create an immutable deployment artifact, follow the documented runtime
   configuration and health procedure, exercise one safe refusal, recover to a
   healthy artifact, and stop it normally.
9. Record the single most important missing or confusing workflow, including
   whether an editor-specific product would have changed the outcome.

Use only `completed`, `refused`, or `abandoned` for task outcome and only
`none`, `public-documentation`, or `facilitator-intervention` for assistance.
Facilitator intervention is retained and cannot be relabeled as independent
success.
